import { describe, expect, it } from 'vitest';
import type { Candle, HealthWeights, RiskWeights, Thresholds } from '@crypto-signal/shared';
import type { MarketSnapshot } from '@crypto-signal/indicators';
import { evaluateSignals } from '@crypto-signal/signal-engine';
import { computeHealth, computeRisk, classifyHealth } from './index.js';

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

const healthWeights: HealthWeights = {
  spotConfirmation: 25,
  futuresPositioning: 15,
  openInterest: 15,
  funding: 10,
  liquidation: 10,
  volume: 10,
  priceStructure: 10,
  divergence: 5,
};

const riskWeights: RiskWeights = {
  fundingExtremity: 25,
  oiVelocity: 20,
  basisExtremity: 15,
  liquidationAnomaly: 20,
  volumeExtremity: 10,
  crowding: 10,
};

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

function baseSnapshot(overrides: {
  priceChangePct?: number;
  spotCvdSkewRatio?: number;
  futuresCvdSkewRatio?: number;
  oiChangePct?: number;
  oiVelocityPctPerHour?: number;
  fundingBias?: MarketSnapshot['futures']['fundingBias'];
  atrPct?: number;
  liquidationSpike?: boolean;
  liquidationAnomalyRatio?: number;
} = {}): MarketSnapshot {
  const atrPct = overrides.atrPct ?? 0.5;
  return {
    symbol: 'BTCUSDT',
    timeframe: '15m',
    timestamp: 899_999,
    price: { open: 65000, high: 65500, low: 64500, close: 65100, changePct: overrides.priceChangePct ?? 0, atrPct, baselineAtrPct: null, structureScore: Math.max(0, 100 - atrPct * 8) },
    spot: { candle: candle({ market: 'spot' }), volume: 1000, cvdDelta: 0, cvdSkewRatio: overrides.spotCvdSkewRatio ?? 0, cvdCumulative: 0, volumeRatio: 1, volumeAnomaly: 'normal' },
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
      oiVelocityPctPerHour: overrides.oiVelocityPctPerHour ?? 0,
      oiPriceInterpretation: 'inconclusive',
      fundingRate: 0,
      fundingRatePct: 0,
      fundingBias: overrides.fundingBias ?? 'neutral',
      basisAbsolute: 0,
      basisPct: 0,
      liquidation: { longLiquidationUsd: 0, shortLiquidationUsd: 0, totalUsd: 0, count: 0 },
      liquidationAnomalyRatio: overrides.liquidationAnomalyRatio ?? 0,
      liquidationSpike: overrides.liquidationSpike ?? false,
    },
    dataQuality: { symbol: 'BTCUSDT', market: 'combined', timeframe: '15m', score: 100, issues: [], evaluatedAt: 899_999 },
  };
}

describe('spec §37 Scenario 1 — Healthy Rally', () => {
  it('produces a high health score and low/moderate risk', () => {
    const snapshot = baseSnapshot({ priceChangePct: 0.5, spotCvdSkewRatio: 0.2, futuresCvdSkewRatio: 0.2, oiChangePct: 3, fundingBias: 'neutral' });
    const signals = evaluateSignals(snapshot, { thresholds, confidenceWeights: { dataQuality: 0.25, confirmation: 0.3, magnitude: 0.25, historical: 0.2 } });
    const health = computeHealth(snapshot, signals, thresholds, healthWeights);
    const risk = computeRisk(snapshot, signals, thresholds, riskWeights);

    expect(health).not.toBeNull();
    expect(health!.score).toBeGreaterThanOrEqual(65);
    expect(risk.score).toBeLessThanOrEqual(50);
  });
});

describe('spec §37 Scenario 2 — Leveraged Rally', () => {
  it('reduces health and raises leverage risk relative to a healthy rally', () => {
    const healthySnapshot = baseSnapshot({ priceChangePct: 0.5, spotCvdSkewRatio: 0.2, futuresCvdSkewRatio: 0.2, oiChangePct: 3, fundingBias: 'neutral' });
    const leveragedSnapshot = baseSnapshot({ priceChangePct: 0.8, spotCvdSkewRatio: -0.25, futuresCvdSkewRatio: 0.25, oiChangePct: 4, fundingBias: 'elevated_positive', oiVelocityPctPerHour: 16 });

    const confidenceWeights = { dataQuality: 0.25, confirmation: 0.3, magnitude: 0.25, historical: 0.2 };
    const healthySignals = evaluateSignals(healthySnapshot, { thresholds, confidenceWeights });
    const leveragedSignals = evaluateSignals(leveragedSnapshot, { thresholds, confidenceWeights });

    const healthyHealth = computeHealth(healthySnapshot, healthySignals, thresholds, healthWeights);
    const leveragedHealth = computeHealth(leveragedSnapshot, leveragedSignals, thresholds, healthWeights);
    const healthyRisk = computeRisk(healthySnapshot, healthySignals, thresholds, riskWeights);
    const leveragedRisk = computeRisk(leveragedSnapshot, leveragedSignals, thresholds, riskWeights);

    expect(healthyHealth).not.toBeNull();
    expect(leveragedHealth).not.toBeNull();
    expect(leveragedHealth!.score).toBeLessThan(healthyHealth!.score);
    expect(leveragedRisk.score).toBeGreaterThan(healthyRisk.score);
  });
});

describe('Health and Risk are independent axes (spec §14)', () => {
  it('a market can score high health and high risk at the same time', () => {
    // Price/spot/futures all agree (healthy trend) but funding is extreme and liquidations are spiking (leverage risk).
    const snapshot = baseSnapshot({
      priceChangePct: 0.4,
      spotCvdSkewRatio: 0.18,
      futuresCvdSkewRatio: 0.18,
      oiChangePct: 1,
      oiVelocityPctPerHour: 10,
      fundingBias: 'extreme_positive',
      liquidationSpike: true,
      liquidationAnomalyRatio: 5,
    });
    const confidenceWeights = { dataQuality: 0.25, confirmation: 0.3, magnitude: 0.25, historical: 0.2 };
    const signals = evaluateSignals(snapshot, { thresholds, confidenceWeights });
    const health = computeHealth(snapshot, signals, thresholds, healthWeights);
    const risk = computeRisk(snapshot, signals, thresholds, riskWeights);

    expect(health).not.toBeNull();
    expect(health!.score).toBeGreaterThanOrEqual(50);
    expect(risk.score).toBeGreaterThanOrEqual(50);
  });
});

describe('classifyHealth buckets (spec §2 exact numbers)', () => {
  it('matches the spec boundaries', () => {
    expect(classifyHealth(85)).toBe('VERY_HEALTHY');
    expect(classifyHealth(70)).toBe('HEALTHY');
    expect(classifyHealth(55)).toBe('NEUTRAL');
    expect(classifyHealth(40)).toBe('WEAK');
    expect(classifyHealth(10)).toBe('VERY_WEAK');
  });
});

describe('Futures-only symbols (no Spot listing, e.g. HYPEUSDT — ASSUMPTIONS.md §15)', () => {
  it('computeHealth returns null when snapshot.spot is null, but Risk still computes fully', () => {
    const snapshot = { ...baseSnapshot({ priceChangePct: 0.8, futuresCvdSkewRatio: 0.25, oiChangePct: 4, fundingBias: 'elevated_positive' }), spot: null };
    const confidenceWeights = { dataQuality: 0.25, confirmation: 0.3, magnitude: 0.25, historical: 0.2 };
    const signals = evaluateSignals(snapshot, { thresholds, confidenceWeights });
    const health = computeHealth(snapshot, signals, thresholds, healthWeights);
    const risk = computeRisk(snapshot, signals, thresholds, riskWeights);

    expect(health).toBeNull();
    expect(risk.score).toBeGreaterThanOrEqual(0);
    expect(risk.score).toBeLessThanOrEqual(100);
    // Spot-dependent signals must never fire without spot data.
    expect(signals.map((s) => s.signalType)).not.toContain('LEVERAGED_RALLY');
    expect(signals.map((s) => s.signalType)).not.toContain('SPOT_CONFIRMED_RALLY');
  });
});
