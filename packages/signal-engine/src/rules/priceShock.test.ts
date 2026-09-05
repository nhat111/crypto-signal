import { describe, expect, it } from 'vitest';
import type { Candle, ConfidenceWeights, Thresholds } from '@crypto-signal/shared';
import type { MarketSnapshot } from '@crypto-signal/indicators';
import { priceShock } from './priceShock.js';
import { evaluateSignals } from '../engine.js';
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
    timeframe: '15m',
    openTime: 0,
    closeTime: 899_999,
    open: 65_000,
    high: 65_500,
    low: 64_500,
    close: 65_100,
    volume: 1000,
    quoteVolume: 65_000_000,
    trades: 5000,
    takerBuyBaseVolume: 500,
    takerBuyQuoteVolume: 32_500_000,
    takerSellBaseVolume: 500,
    ingestedAt: 0,
  };
}

function snapshot(o: {
  changePct: number;
  baselineAtrPct: number | null;
  volumeRatio?: number;
  liquidationSpike?: boolean;
}): MarketSnapshot {
  return {
    symbol: 'BTCUSDT',
    timeframe: '15m',
    timestamp: 899_999,
    price: {
      open: 65_000,
      high: 65_500,
      low: 64_500,
      close: 65_100,
      changePct: o.changePct,
      atrPct: 0.5,
      baselineAtrPct: o.baselineAtrPct,
      structureScore: 80,
    },
    spot: null,
    futures: {
      candle: candle(),
      volume: 1000,
      cvdDelta: 0,
      cvdSkewRatio: 0,
      cvdCumulative: 0,
      volumeRatio: o.volumeRatio ?? 1,
      volumeAnomaly: 'normal',
      openInterest: 50_000,
      oiChangePct: 0,
      oiVelocityPctPerHour: 0,
      oiPriceInterpretation: 'inconclusive',
      fundingRate: 0,
      fundingRatePct: 0,
      fundingBias: 'neutral',
      basisAbsolute: 0,
      basisPct: 0,
      liquidation: { longLiquidationUsd: 0, shortLiquidationUsd: 0, totalUsd: 0, count: 0 },
      liquidationAnomalyRatio: 0,
      liquidationSpike: o.liquidationSpike ?? false,
    },
    dataQuality: {
      symbol: 'BTCUSDT',
      market: 'combined',
      timeframe: '15m',
      score: 100,
      issues: [],
      evaluatedAt: 0,
    },
  };
}

const run = (s: MarketSnapshot) =>
  priceShock({ snapshot: s, thresholds, confidenceWeights, getHistoricalScore: () => undefined } as RuleContext);

describe('priceShock', () => {
  it('fires on a dump far outside the symbol’s own recent range', () => {
    // 0,4% is an ordinary candle here; −2,4% is six times that.
    const signal = run(snapshot({ changePct: -2.4, baselineAtrPct: 0.4 }));
    expect(signal?.signalType).toBe('PRICE_SPIKE_DOWN');
    expect(signal?.metrics.shockRatio).toBeCloseTo(6, 5);
  });

  it('fires on a pump, as a different signal type', () => {
    // Up and down must never share a type: their follow-through is
    // different, and one blended hit rate would average to a coin flip.
    expect(run(snapshot({ changePct: 2.4, baselineAtrPct: 0.4 }))?.signalType).toBe('PRICE_SPIKE_UP');
  });

  it('stays silent with no baseline, however violent the candle', () => {
    // The cold-start case. Without this the first candles after every
    // deploy would each look infinitely abnormal and alert the channel
    // into being muted.
    expect(run(snapshot({ changePct: -12, baselineAtrPct: null }))).toBeNull();
  });

  it('stays silent when the move is tiny, however flat the market was', () => {
    // 0,3% against a 0,05% baseline is six times "normal" and still
    // nothing worth waking up for.
    expect(run(snapshot({ changePct: -0.3, baselineAtrPct: 0.05 }))).toBeNull();
  });

  it('stays silent when a big move is ordinary for this market', () => {
    // −2,4% matters on a quiet week and is a Tuesday when the symbol
    // routinely ranges 1,5% a candle. A fixed percentage cannot tell
    // these apart; that is the whole reason the baseline exists.
    expect(run(snapshot({ changePct: -2.4, baselineAtrPct: 1.5 }))).toBeNull();
  });

  it('is louder the further outside the range the candle sits', () => {
    // Ratios 3,2 / 4,8 / 6,4 — deliberately off the exact thresholds, so
    // this measures the escalation rule and not float rounding at 3,0.
    const at3 = run(snapshot({ changePct: -1.6, baselineAtrPct: 0.5 }));
    const at4x5 = run(snapshot({ changePct: -2.4, baselineAtrPct: 0.5 }));
    const at6 = run(snapshot({ changePct: -3.2, baselineAtrPct: 0.5 }));
    expect(at3?.severity).toBe('MEDIUM');
    expect(at4x5?.severity).toBe('HIGH');
    expect(at6?.severity).toBe('EXTREME');
  });

  it('says out loud whether real volume came with the move', () => {
    // A 3% candle on thin volume and one on triple volume are different
    // events, and the reader cannot see volume from the price alone.
    const thin = run(snapshot({ changePct: -2.4, baselineAtrPct: 0.4, volumeRatio: 0.8 }));
    const heavy = run(snapshot({ changePct: -2.4, baselineAtrPct: 0.4, volumeRatio: 3 }));
    expect(thin?.reasons.join(' ')).toContain('mỏng');
    expect(heavy?.reasons.join(' ')).toContain('tiền thật');
    expect(heavy!.confidence).toBeGreaterThan(thin!.confidence);
  });

  it('mentions forced closing only when there was some', () => {
    const quiet = run(snapshot({ changePct: -2.4, baselineAtrPct: 0.4 }));
    const cascade = run(snapshot({ changePct: -2.4, baselineAtrPct: 0.4, liquidationSpike: true }));
    expect(quiet?.reasons.join(' ')).not.toContain('cháy lệnh');
    expect(cascade?.reasons.join(' ')).toContain('cháy lệnh');
  });

  it('is reached through the engine, not only when called directly', () => {
    // A rule that is never registered is a rule that never fires.
    const types = evaluateSignals(snapshot({ changePct: -2.4, baselineAtrPct: 0.4 }), {
      thresholds,
      confidenceWeights,
    }).map((s) => s.signalType);
    expect(types).toContain('PRICE_SPIKE_DOWN');
  });
});
