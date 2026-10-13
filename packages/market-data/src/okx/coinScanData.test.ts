import { describe, expect, it } from 'vitest';
import { mergeTakerVolume, parseClosedCandles, parseSpotTickers, parseSwapTickers } from './coinScanData.js';

const DAY = 86_400_000;
const D = Date.UTC(2026, 9, 10);

describe('parseSpotTickers', () => {
  it('keeps live USDT coins and drops tokenized stocks, gold and other quotes', () => {
    const instruments = [
      { instId: 'BTC-USDT', instCategory: '1', state: 'live' },
      { instId: 'XAAPL-USDT', instCategory: '3', state: 'live' },
      { instId: 'XAUT-USDT', instCategory: '4', state: 'live' },
      { instId: 'OLD-USDT', instCategory: '1', state: 'suspend' },
      { instId: 'BTC-USDC', instCategory: '1', state: 'live' },
    ];
    const t = (instId: string) => ({ instId, last: '2', volCcy24h: '1000', ts: '42' });
    const rows = parseSpotTickers(instruments, ['BTC-USDT', 'XAAPL-USDT', 'XAUT-USDT', 'OLD-USDT', 'BTC-USDC'].map(t));
    expect(rows).toEqual([{ symbol: 'BTCUSDT', lastPrice: 2, quoteVolume: 1000, closeTime: 42 }]);
  });
});

describe('parseSwapTickers', () => {
  it('turns base-currency volume into quote volume and names the perp like the spot pair', () => {
    expect(parseSwapTickers([{ instId: 'SOL-USDT-SWAP', last: '100', volCcy24h: '5', ts: '1' }, { instId: 'BTC-USD-SWAP', last: '1', volCcy24h: '1', ts: '1' }])).toEqual([
      { symbol: 'SOLUSDT', lastPrice: 100, quoteVolume: 500, closeTime: 1 },
    ]);
  });
});

describe('parseClosedCandles + mergeTakerVolume', () => {
  const candles = [D + DAY, D, D - DAY].map((ts) => [String(ts), '1', '2', '0.5', '1.5', '10', '0', '0', '1']);

  it('drops the day still forming and orders oldest first', () => {
    const bars = parseClosedCandles(candles, D + DAY + 3_600_000);
    expect(bars.map((b) => b.openTime)).toEqual([D - DAY, D]);
    expect(bars[1]?.closeTime).toBe(D + DAY - 1);
  });

  it('assigns each Hong Kong taker day to the UTC day it mostly covers', () => {
    const bars = parseClosedCandles(candles, D + 2 * DAY);
    // The HK day for UTC day D opens at D − 8h.
    const taker = [
      [String(D + DAY - 8 * 3_600_000), '40', '60'],
      [String(D - 8 * 3_600_000), '30', '70'],
    ];
    const merged = mergeTakerVolume(bars, taker);
    expect(merged.map((b) => [b.openTime, b.quoteVolume, b.takerBuyQuoteVolume])).toEqual([
      [D - DAY, 0, 0],
      [D, 100, 70],
      [D + DAY, 100, 60],
    ]);
  });
});
