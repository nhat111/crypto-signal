import { describe, expect, it } from 'vitest';
import type { Candle, ConfidenceWeights, Thresholds } from '@crypto-signal/shared';
import type { MarketSnapshot, VolumeAnomalyLevel } from '@crypto-signal/indicators';
import { evaluateSignals } from './engine.js';
import type { SignalType } from './types.js';

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

function candle(overrides: Partial<Candle> = {}): Candle {
  return {
    symbol: 'BTCUSDT',
    market: 'futures',
    timeframe: '15m',
    openTime: 0,
    closeTime: 899_999,
    open: 65000,
    high: 65500,
    low: 64500,
    close: 65100,
    volume: 1000,
    quoteVolume: 65_000_000,
    trades: 5000,
    takerBuyBaseVolume: 500,
    takerBuyQuoteVolume: 32_500_000,
    takerSellBaseVolume: 500,
    ingestedAt: 0,
    ...overrides,
  };
}

/** A neutral, no-signal-firing baseline snapshot — every scenario overrides only what it needs. */
function baseSnapshot(overrides: {
  priceChangePct?: number;
  spotCvdSkewRatio?: number;
  futuresCvdSkewRatio?: number;
  oiChangePct?: number;
  fundingBias?: MarketSnapshot['futures']['fundingBias'];
  fundingRatePct?: number;
  longLiquidationUsd?: number;
  shortLiquidationUsd?: number;
  liquidationAnomalyRatio?: number;
  liquidationSpike?: boolean;
  spotVolumeAnomaly?: VolumeAnomalyLevel;
  dataQualityScore?: number;
} = {}): MarketSnapshot {
  return {
    symbol: 'BTCUSDT',
    timeframe: '15m',
    timestamp: 899_999,
    price: {
      open: 65000,
      high: 65500,
      low: 64500,
      close: 65100,
      changePct: overrides.priceChangePct ?? 0,
      atrPct: 0.5,
      baselineAtrPct: null,
      structureScore: 80,
    },
    spot: {
      candle: candle({ market: 'spot' }),
      volume: 1000,
      cvdDelta: 0,
      cvdSkewRatio: overrides.spotCvdSkewRatio ?? 0,
      cvdCumulative: 0,
      volumeRatio: 1,
      volumeAnomaly: overrides.spotVolumeAnomaly ?? 'normal',
    },
    futures: {
      candle: candle(),
      volume: 1000,
      cvdDelta: 0,
      cvdSkewRatio: overrides.futuresCvdSkewRatio ?? 0,
      cvdCumulative: 0,
      volumeRatio: 1,
      volumeAnomaly: 'normal',
      openInterest: 50_000,
      oiChangePct: overrides.oiChangePct ?? 0,
      oiVelocityPctPerHour: 0,
      oiPriceInterpretation: 'inconclusive',
      fundingRate: (overrides.fundingRatePct ?? 0) / 100,
      fundingRatePct: overrides.fundingRatePct ?? 0,
      fundingBias: overrides.fundingBias ?? 'neutral',
      basisAbsolute: 0,
      basisPct: 0,
      liquidation: {
        longLiquidationUsd: overrides.longLiquidationUsd ?? 0,
        shortLiquidationUsd: overrides.shortLiquidationUsd ?? 0,
        totalUsd: (overrides.longLiquidationUsd ?? 0) + (overrides.shortLiquidationUsd ?? 0),
        count: 0,
      },
      liquidationAnomalyRatio: overrides.liquidationAnomalyRatio ?? 0,
      liquidationSpike: overrides.liquidationSpike ?? false,
    },
    dataQuality: {
      symbol: 'BTCUSDT',
      market: 'combined',
      timeframe: '15m',
      score: overrides.dataQualityScore ?? 100,
      issues: [],
      evaluatedAt: 899_999,
    },
  };
}

function signalsOf(snapshot: MarketSnapshot): { type: SignalType; severity: string; confidence: number }[] {
  return evaluateSignals(snapshot, { thresholds, confidenceWeights }).map((s) => ({ type: s.signalType, severity: s.severity, confidence: s.confidence }));
}

describe('spec §37 Scenario 1 — Healthy Rally', () => {
  it('fires SPOT_CONFIRMED_RALLY, not LEVERAGED_RALLY', () => {
    const snapshot = baseSnapshot({
      priceChangePct: 0.5,
      spotCvdSkewRatio: 0.2,
      futuresCvdSkewRatio: 0.2,
      oiChangePct: 3,
      fundingBias: 'neutral',
    });
    const signals = signalsOf(snapshot);
    expect(signals.map((s) => s.type)).toContain('SPOT_CONFIRMED_RALLY');
    expect(signals.map((s) => s.type)).not.toContain('LEVERAGED_RALLY');
  });
});

describe('spec §37 Scenario 2 — Leveraged Rally', () => {
  it('fires LEVERAGED_RALLY with elevated funding escalating severity above baseline MEDIUM', () => {
    const snapshot = baseSnapshot({
      priceChangePct: 0.8,
      spotCvdSkewRatio: -0.25,
      futuresCvdSkewRatio: 0.25,
      oiChangePct: 4,
      fundingBias: 'elevated_positive',
      fundingRatePct: 0.015,
    });
    const signals = evaluateSignals(snapshot, { thresholds, confidenceWeights });
    const leveraged = signals.find((s) => s.signalType === 'LEVERAGED_RALLY');
    expect(leveraged).toBeDefined();
    expect(leveraged?.severity).toBe('HIGH'); // MEDIUM base + 1 for elevated funding
    expect(signals.map((s) => s.signalType)).not.toContain('SPOT_CONFIRMED_RALLY');
  });
});

describe('spec §37 Scenario 3 — Short Covering', () => {
  it('fires SHORT_COVERING_POSSIBLE, capped confidence, not treated as confirmed bullish', () => {
    const snapshot = baseSnapshot({ priceChangePct: 0.5, oiChangePct: -3, futuresCvdSkewRatio: 0.2 });
    const signals = evaluateSignals(snapshot, { thresholds, confidenceWeights });
    const shortCovering = signals.find((s) => s.signalType === 'SHORT_COVERING_POSSIBLE');
    expect(shortCovering).toBeDefined();
    expect(shortCovering!.confidence).toBeLessThanOrEqual(65);
    expect(signals.map((s) => s.signalType)).not.toContain('SPOT_CONFIRMED_RALLY');
  });
});

describe('spec §37 Scenario 4 — Long Liquidation', () => {
  it('fires LONG_LIQUIDATION on price down + OI down + long-skewed liquidation spike', () => {
    const snapshot = baseSnapshot({
      priceChangePct: -0.5,
      oiChangePct: -3,
      longLiquidationUsd: 5000,
      shortLiquidationUsd: 500,
      liquidationAnomalyRatio: 4,
      liquidationSpike: true,
    });
    const signals = signalsOf(snapshot);
    expect(signals.map((s) => s.type)).toContain('LONG_LIQUIDATION');
    expect(signals.map((s) => s.type)).not.toContain('SHORT_LIQUIDATION');
  });
});

describe('spec §37 Scenario 5 — Selling Absorption', () => {
  it('fires SELLING_ABSORPTION_POSSIBLE with low confidence when unconfirmed', () => {
    const snapshot = baseSnapshot({ spotCvdSkewRatio: -0.2, priceChangePct: 0.1, spotVolumeAnomaly: 'normal' });
    const signals = evaluateSignals(snapshot, { thresholds, confidenceWeights });
    const absorption = signals.find((s) => s.signalType === 'SELLING_ABSORPTION_POSSIBLE');
    expect(absorption).toBeDefined();
    expect(absorption!.confidence).toBeLessThanOrEqual(45);
  });
});

describe('Bullish Spot Divergence (spec §7 Pattern D)', () => {
  it('fires BULLISH_SPOT_DIVERGENCE when price falls but spot is net buying', () => {
    const snapshot = baseSnapshot({ priceChangePct: -0.5, spotCvdSkewRatio: 0.2 });
    const signals = signalsOf(snapshot);
    expect(signals.map((s) => s.type)).toContain('BULLISH_SPOT_DIVERGENCE');
  });
});

describe('Missing / low-quality data (spec §29-§30)', () => {
  it('never produces high confidence from a low data-quality snapshot, even with a strong trigger', () => {
    const strongSetup = { priceChangePct: 0.8, spotCvdSkewRatio: -0.25, futuresCvdSkewRatio: 0.25, oiChangePct: 4 };
    const highQuality = signalsOf(baseSnapshot({ ...strongSetup, dataQualityScore: 100 })).find((s) => s.type === 'LEVERAGED_RALLY');
    const lowQuality = signalsOf(baseSnapshot({ ...strongSetup, dataQualityScore: 10 })).find((s) => s.type === 'LEVERAGED_RALLY');

    expect(highQuality).toBeDefined();
    expect(lowQuality).toBeDefined();
    expect(lowQuality!.confidence).toBeLessThan(highQuality!.confidence);
  });
});

describe('No conditions met', () => {
  it('produces no signals for a flat, unremarkable snapshot', () => {
    expect(signalsOf(baseSnapshot())).toHaveLength(0);
  });
});
