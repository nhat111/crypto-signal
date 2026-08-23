import { describe, expect, it } from 'vitest';
import type { Candle } from '@crypto-signal/shared';
import { CandlePairBuffer } from './state.js';

function candle(market: 'spot' | 'futures', openTime: number): Candle {
  return {
    symbol: 'BTCUSDT',
    market,
    timeframe: '5m',
    openTime,
    closeTime: openTime + 299_999,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    quoteVolume: 1,
    trades: 1,
    takerBuyBaseVolume: 1,
    takerBuyQuoteVolume: 1,
    takerSellBaseVolume: 0,
    ingestedAt: 0,
  };
}

describe('CandlePairBuffer', () => {
  it('returns null until both sides of the same openTime have arrived', () => {
    const buffer = new CandlePairBuffer();
    expect(buffer.add(candle('spot', 1000))).toBeNull();
  });

  it('pairs spot and futures candles for the same openTime regardless of arrival order', () => {
    const buffer = new CandlePairBuffer();
    buffer.add(candle('futures', 1000));
    const pair = buffer.add(candle('spot', 1000));
    expect(pair).not.toBeNull();
    expect(pair?.spot.market).toBe('spot');
    expect(pair?.futures.market).toBe('futures');
  });

  it('keeps different openTimes independent', () => {
    const buffer = new CandlePairBuffer();
    buffer.add(candle('spot', 1000));
    expect(buffer.add(candle('futures', 2000))).toBeNull();
    expect(buffer.add(candle('futures', 1000))).not.toBeNull();
  });

  it('reports a timed-out entry once maxWaitMs has elapsed with only one side present', () => {
    const buffer = new CandlePairBuffer(0); // maxWaitMs=0 so it's immediately "timed out"
    buffer.add(candle('spot', 1000));
    const timedOut = buffer.timedOutEntries(Date.now() + 1);
    expect(timedOut).toHaveLength(1);
    expect(timedOut[0]?.missing).toBe('futures');
  });
});
