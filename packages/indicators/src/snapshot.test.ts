import { describe, expect, it } from 'vitest';
import type { Candle, Thresholds } from '@crypto-signal/shared';
import { computeFuturesOnlySnapshot } from './snapshot.js';

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

function candle(overrides: Partial<Candle> = {}): Candle {
  return {
    symbol: 'BTCUSDT',
    market: 'futures',
    timeframe: '15m',
    openTime: 0,
    closeTime: 899_999,
    open: 10_000,
    high: 10_050,
    low: 9_950,
    close: 10_010,
    volume: 1000,
    quoteVolume: 10_000_000,
    trades: 5000,
    takerBuyBaseVolume: 500,
    takerBuyQuoteVolume: 5_000_000,
    takerSellBaseVolume: 500,
    ingestedAt: 0,
    ...overrides,
  };
}

function build(futuresCandle: Candle, recentTrueRanges: number[]) {
  return computeFuturesOnlySnapshot({
    symbol: 'BTCUSDT',
    timeframe: '15m',
    futuresCandle,
    previousFuturesCumulativeCvd: 0,
    futuresVolumeHistory: [1000],
    previousOpenInterest: undefined,
    currentOpenInterest: { symbol: 'BTCUSDT', timeframe: '15m', timestamp: 0, sumOpenInterest: 100, sumOpenInterestValue: 1_000_000 },
    fundingRateFraction: 0,
    liquidationEventsInWindow: [],
    rollingLiquidation24hUsd: 0,
    previousFuturesClose: 10_000,
    recentTrueRanges,
    dataQuality: {
      symbol: 'BTCUSDT',
      market: 'combined',
      timeframe: '15m',
      score: 100,
      issues: [],
      evaluatedAt: 0,
    },
    thresholds,
  });
}

describe('snapshot volatility baseline', () => {
  const calmHistory = Array.from({ length: 14 }, () => 100); // 1% of a 10.000 price

  it('reports the baseline from prior candles, not from the current one', () => {
    // The regression this exists to catch: feeding the current true range
    // into the baseline as well. A crash candle would then set the bar it
    // is measured against, and the biggest moves — the only ones worth an
    // alert — would be the ones that quietly stop qualifying.
    const crash = candle({ open: 10_000, high: 10_000, low: 9_000, close: 9_050 });
    const snapshot = build(crash, calmHistory);

    expect(snapshot.price.baselineAtrPct).toBeCloseTo(1, 6);
    // The descriptive figure does include it, and is far larger. If these
    // two ever agree, the baseline has been contaminated.
    expect(snapshot.price.atrPct).toBeGreaterThan(1.5);
  });

  it('has no baseline until enough candles have gone by', () => {
    expect(build(candle(), [100, 100, 100]).price.baselineAtrPct).toBeNull();
  });
});
