import { describe, expect, it } from 'vitest';
import type { Candle } from '@crypto-signal/shared';
import { accumulateCvd, computeCandleDelta, computeSkewRatio } from './cvd.js';

function makeCandle(overrides: Partial<Candle> = {}): Candle {
  return {
    symbol: 'BTCUSDT',
    market: 'spot',
    timeframe: '5m',
    openTime: 0,
    closeTime: 299_999,
    open: 100,
    high: 105,
    low: 95,
    close: 102,
    volume: 1000,
    quoteVolume: 100_000,
    trades: 500,
    takerBuyBaseVolume: 300,
    takerBuyQuoteVolume: 30_000,
    takerSellBaseVolume: 700,
    ingestedAt: 0,
    ...overrides,
  };
}

describe('CVD — never derived from candle color', () => {
  it('computes delta purely from taker buy/sell volume, ignoring open/close direction', () => {
    // A RED candle (close < open) with MORE taker buying than selling must
    // still produce a positive delta — proving color isn't used anywhere.
    const redCandleNetBuying = makeCandle({ open: 110, close: 100, takerBuyBaseVolume: 800, takerSellBaseVolume: 200, volume: 1000 });
    expect(computeCandleDelta(redCandleNetBuying)).toBe(600);
    expect(computeSkewRatio(redCandleNetBuying)).toBeCloseTo(0.6, 10);
  });

  it('computes a negative delta for a GREEN candle with net selling', () => {
    const greenCandleNetSelling = makeCandle({ open: 100, close: 110, takerBuyBaseVolume: 200, takerSellBaseVolume: 800, volume: 1000 });
    expect(computeCandleDelta(greenCandleNetSelling)).toBe(-600);
    expect(computeSkewRatio(greenCandleNetSelling)).toBeCloseTo(-0.6, 10);
  });

  it('returns 0 skew ratio for a zero-volume candle instead of dividing by zero', () => {
    const empty = makeCandle({ volume: 0, takerBuyBaseVolume: 0, takerSellBaseVolume: 0 });
    expect(computeSkewRatio(empty)).toBe(0);
  });

  it('accumulates cumulative CVD across candles', () => {
    const c1 = makeCandle({ takerBuyBaseVolume: 600, takerSellBaseVolume: 400 });
    const c2 = makeCandle({ takerBuyBaseVolume: 300, takerSellBaseVolume: 700 });
    const afterC1 = accumulateCvd(0, c1);
    const afterC2 = accumulateCvd(afterC1, c2);
    expect(afterC1).toBe(200);
    expect(afterC2).toBe(200 + (300 - 700));
  });
});
