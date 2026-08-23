import { describe, expect, it } from 'vitest';
import { CandleSequenceGuard, rawKlineToCandle, wsKlineToCandle, forceOrderToLiquidation, type RawKline, type WsKlinePayload, type ForceOrderPayload } from './normalizer.js';

const RAW: RawKline = [1700000000000, '100', '110', '90', '105', '1000', 1700000299999, '105000', 500, '600', '63000', '0'];

describe('rawKlineToCandle', () => {
  it('maps every field, including taker sell volume derived once here', () => {
    const candle = rawKlineToCandle(RAW, 'BTCUSDT', 'spot', '5m');
    expect(candle.open).toBe(100);
    expect(candle.close).toBe(105);
    expect(candle.volume).toBe(1000);
    expect(candle.takerBuyBaseVolume).toBe(600);
    expect(candle.takerSellBaseVolume).toBe(400);
    expect(candle.symbol).toBe('BTCUSDT');
    expect(candle.market).toBe('spot');
    expect(candle.timeframe).toBe('5m');
  });
});

describe('wsKlineToCandle', () => {
  const basePayload: WsKlinePayload = {
    t: 1700000000000,
    T: 1700000299999,
    o: '100',
    h: '110',
    l: '90',
    c: '105',
    v: '1000',
    n: 500,
    x: true,
    q: '105000',
    V: '600',
    Q: '63000',
  };

  it('returns null for a candle that has not closed yet', () => {
    expect(wsKlineToCandle({ ...basePayload, x: false }, 'BTCUSDT', 'spot', '5m')).toBeNull();
  });

  it('maps a closed candle', () => {
    const candle = wsKlineToCandle(basePayload, 'BTCUSDT', 'futures', '5m');
    expect(candle).not.toBeNull();
    expect(candle?.takerSellBaseVolume).toBe(400);
    expect(candle?.market).toBe('futures');
  });
});

describe('forceOrderToLiquidation', () => {
  it('maps side and computes quote quantity', () => {
    const payload: ForceOrderPayload = {
      o: { s: 'BTCUSDT', S: 'SELL', o: 'LIMIT', q: '2', p: '65000', ap: '64950', X: 'FILLED', T: 1700000000000 },
    };
    const event = forceOrderToLiquidation(payload);
    expect(event.side).toBe('SELL');
    expect(event.quoteQuantity).toBeCloseTo(129900, 5);
  });
});

describe('CandleSequenceGuard', () => {
  function candleAt(openTime: number): ReturnType<typeof rawKlineToCandle> {
    return rawKlineToCandle(
      [openTime, '1', '1', '1', '1', '1', openTime + 299999, '1', 1, '1', '1', '0'],
      'BTCUSDT',
      'spot',
      '5m',
    );
  }

  it('accepts the first candle unconditionally', () => {
    const guard = new CandleSequenceGuard('5m');
    const result = guard.accept(candleAt(1_700_000_000_000));
    expect(result).toEqual({ accepted: true, gapCandles: 0 });
  });

  it('accepts a normal next-in-sequence candle with no gap', () => {
    const guard = new CandleSequenceGuard('5m');
    guard.accept(candleAt(1_700_000_000_000));
    const result = guard.accept(candleAt(1_700_000_300_000));
    expect(result).toEqual({ accepted: true, gapCandles: 0 });
  });

  it('rejects a duplicate candle (same openTime redelivered)', () => {
    const guard = new CandleSequenceGuard('5m');
    guard.accept(candleAt(1_700_000_000_000));
    const result = guard.accept(candleAt(1_700_000_000_000));
    expect(result).toEqual({ accepted: false, reason: 'duplicate' });
  });

  it('rejects an out-of-order candle (older than the last seen)', () => {
    const guard = new CandleSequenceGuard('5m');
    guard.accept(candleAt(1_700_000_300_000));
    const result = guard.accept(candleAt(1_700_000_000_000));
    expect(result).toEqual({ accepted: false, reason: 'out_of_order' });
  });

  it('detects a gap when candles are missing in between', () => {
    const guard = new CandleSequenceGuard('5m');
    guard.accept(candleAt(1_700_000_000_000));
    // Skips two 5m buckets (300_000ms and 600_000ms), lands on the third.
    const result = guard.accept(candleAt(1_700_000_900_000));
    expect(result).toEqual({ accepted: true, gapCandles: 2 });
  });
});
