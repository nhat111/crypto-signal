import { describe, expect, it } from 'vitest';
import type { Candle, ConfidenceWeights, Thresholds } from '@crypto-signal/shared';
import type { MarketSnapshot, VolumeAnomalyLevel } from '@crypto-signal/indicators';
import { spotConfirmedRally } from './spotConfirmedRally.js';
import type { RuleContext } from '../types.js';

const thresholds: Thresholds = {
  priceChangePct: 0.3,
  cvdSkewRatio: 0.15,
  oiChangePct: 2,
  oiStrongChangePct: 5,
  fundingElevatedPct: 0.01,
  fundingExtremePct: 0.03,
  volumeElevatedMult: 1.5,
  volumeAbnormalMult: 2,
  volumeExtremeMult: 3,
  liquidationSpikeMult: 3,
  basisElevatedPct: 0.1,
  priceShockAtrMult: 3,
  priceShockMinMovePct: 1,
};

const confidenceWeights: ConfidenceWeights = { dataQuality: 0.25, confirmation: 0.3, magnitude: 0.25, historical: 0.2 };

function candle(): Candle {
  return {
    symbol: 'BTCUSDT',
    market: 'futures',
    timeframe: '4h',
    openTime: 0,
    closeTime: 899_999,
    open: 100,
    high: 101,
    low: 99,
    close: 100.3,
    volume: 1000,
    quoteVolume: 100_000,
    trades: 500,
    takerBuyBaseVolume: 500,
    takerBuyQuoteVolume: 50_000,
    takerSellBaseVolume: 500,
    ingestedAt: 0,
  };
}

/** A rally that qualifies. Every knob below is something the trigger permits either way. */
function rally(o: {
  priceChangePct?: number;
  spotSkew?: number;
  spotVolumeAnomaly?: VolumeAnomalyLevel;
} = {}): MarketSnapshot {
  return {
    symbol: 'BTCUSDT',
    timeframe: '4h',
    timestamp: 899_999,
    price: {
      open: 100,
      high: 101,
      low: 99,
      close: 100.3,
      changePct: o.priceChangePct ?? 0.3,
      atrPct: 0.5,
      baselineAtrPct: 0.4,
      structureScore: 80,
    },
    spot: {
      candle: candle(),
      volume: 1000,
      cvdDelta: 0,
      cvdSkewRatio: o.spotSkew ?? 0.084,
      cvdCumulative: 0,
      volumeRatio: 1,
      volumeAnomaly: o.spotVolumeAnomaly ?? 'normal',
    },
    futures: {
      candle: candle(),
      volume: 1000,
      cvdDelta: 0,
      cvdSkewRatio: 0.062,
      cvdCumulative: 0,
      volumeRatio: 1,
      volumeAnomaly: 'normal',
      openInterest: 1000,
      oiChangePct: 0.09,
      oiVelocityPctPerHour: 0,
      oiPriceInterpretation: 'inconclusive',
      fundingRate: 0.000025,
      fundingRatePct: 0.0025,
      fundingBias: 'neutral',
      basisAbsolute: 0,
      basisPct: 0,
      liquidation: { longLiquidationUsd: 0, shortLiquidationUsd: 0, totalUsd: 0, count: 0 },
      liquidationAnomalyRatio: 0,
      liquidationSpike: false,
    },
    dataQuality: {
      symbol: 'BTCUSDT',
      market: 'combined',
      timeframe: '4h',
      score: 100,
      issues: [],
      evaluatedAt: 0,
    },
  };
}

const run = (s: MarketSnapshot) =>
  spotConfirmedRally({ snapshot: s, thresholds, confidenceWeights, getHistoricalScore: () => undefined } as RuleContext);

describe('spotConfirmedRally confidence actually measures something', () => {
  it('does not hand every instance the same score', () => {
    // The bug this replaced: `confirmed` was hardcoded to 2 of 2, so the
    // confirmation term contributed a constant 30 of 100 points to every
    // instance however weak the rally was — and made the number
    // incomparable with rules that have a check able to fail.
    const weakest = run(rally({ priceChangePct: 0.3, spotSkew: 0.01, spotVolumeAnomaly: 'normal' }));
    const strongest = run(rally({ priceChangePct: 1.2, spotSkew: 0.4, spotVolumeAnomaly: 'extreme' }));
    expect(weakest).not.toBeNull();
    expect(strongest).not.toBeNull();
    expect(strongest!.confidence - weakest!.confidence).toBeGreaterThan(40);
  });

  it('counts spot buying that clears the meaningful threshold', () => {
    // The trigger only asks for skew above zero, so "barely positive" and
    // "genuinely strong" both qualify and must not score the same.
    const barely = run(rally({ spotSkew: 0.01 }))!;
    const meaningful = run(rally({ spotSkew: 0.15 }))!;
    expect(meaningful.confidence).toBeGreaterThan(barely.confidence);
    expect(meaningful.reasons.join(' ')).toContain('vượt ngưỡng đáng kể');
    expect(barely.reasons.join(' ')).toContain('cú tăng mỏng');
  });

  it('counts volume backing the move', () => {
    const quiet = run(rally({ spotVolumeAnomaly: 'normal' }))!;
    const heavy = run(rally({ spotVolumeAnomaly: 'abnormal' }))!;
    expect(heavy.confidence).toBeGreaterThan(quiet.confidence);
    expect(quiet.reasons.join(' ')).toContain('mức bình thường');
    expect(heavy.reasons.join(' ')).toContain('có tiền thật đi kèm');
  });

  it('scores magnitude against the threshold that actually gated it', () => {
    // Previously it compared the spot skew against 0,15 — a threshold this
    // rule never applies, since it fires on skew merely being above zero.
    // Everything below 0,15 therefore sat on the magnitude floor no matter
    // how it differed. The price move is what the rule does gate on.
    const atTheLine = run(rally({ priceChangePct: 0.3 }))!;
    const wellPast = run(rally({ priceChangePct: 0.9 }))!;
    expect(wellPast.confidence).toBeGreaterThan(atTheLine.confidence);

    // And the skew no longer moves magnitude on its own — it is a
    // confirmation now, worth one step, not a sliding scale.
    const sameConfirmations = [0.16, 0.3, 0.9].map((spotSkew) => run(rally({ spotSkew }))!.confidence);
    expect(new Set(sameConfirmations).size).toBe(1);
  });

  it('still refuses to fire when the trigger is not met', () => {
    // The gate is unchanged: these are mandatory, not confirmations.
    expect(run(rally({ priceChangePct: 0.29 }))).toBeNull();
    expect(run(rally({ spotSkew: 0 }))).toBeNull();
    expect(run(rally({ spotSkew: -0.2 }))).toBeNull();
  });

  it('lands the weak case where a failed-confirmation signal lands', () => {
    // The point of the fix: a rally with neither confirmation should score
    // like any other signal with 0 of its checks held, not 30 points above
    // it. Data quality 100, magnitude at the floor, historical at its
    // default: 25 + 0 + 5 + 10.
    const weak = run(rally({ priceChangePct: 0.3, spotSkew: 0.01, spotVolumeAnomaly: 'normal' }))!;
    expect(weak.confidence).toBe(40);
  });

  it('reaches the top only when everything holds', () => {
    const best = run(rally({ priceChangePct: 1.5, spotSkew: 0.5, spotVolumeAnomaly: 'extreme' }))!;
    // 25 + 30 + 25 + 10 — the historical term is the only one still at its
    // default, and it stays there until the type has 30 recorded outcomes.
    expect(best.confidence).toBe(90);
  });
});
