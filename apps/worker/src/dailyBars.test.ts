import { describe, expect, it, vi } from 'vitest';
import type { DailyBar } from '@crypto-signal/market-data';
import { fetchDailyBarsWithFallback } from './dailyBars.js';

const bar = (openTime: number): DailyBar => ({
  openTime,
  closeTime: openTime + 86_399_999,
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  volume: 1,
});
const banned = Object.assign(new Error('Binance REST 418 on /api/v3/klines: IP banned until 2026-10-10T00:38:59.447Z'), {
  status: 418,
});

describe('fetchDailyBarsWithFallback', () => {
  it('uses Binance when it answers, and never asks OKX', async () => {
    const okx = vi.fn(async () => [bar(1)]);
    const result = await fetchDailyBarsWithFallback(async () => [bar(0)], okx, 'BTCUSDT', 400, 0);
    expect(result).toEqual({ bars: [bar(0)], source: 'binance' });
    expect(okx).not.toHaveBeenCalled();
  });

  it('reads OKX when Binance has banned the server', async () => {
    const okx = vi.fn(async () => [bar(1)]);
    const result = await fetchDailyBarsWithFallback(async () => { throw banned; }, okx, 'BTCUSDT', 400, 7);
    expect(result).toEqual({ bars: [bar(1)], source: 'okx' });
    expect(okx).toHaveBeenCalledWith('BTCUSDT', 400, 7);
  });

  it('does not ask OKX about a symbol Binance rejected as invalid', async () => {
    const invalid = Object.assign(new Error('Binance REST 400'), { status: 400 });
    const okx = vi.fn(async () => [bar(1)]);
    await expect(fetchDailyBarsWithFallback(async () => { throw invalid; }, okx, 'NOPEUSDT', 400, 0)).rejects.toBe(invalid);
    expect(okx).not.toHaveBeenCalled();
  });

  it('keeps the Binance error when OKX does not list the pair', async () => {
    await expect(fetchDailyBarsWithFallback(async () => { throw banned; }, async () => [], 'XUSDT', 400, 0)).rejects.toBe(banned);
  });

  it('names both failures when OKX is down too', async () => {
    const okxDown = async (): Promise<DailyBar[]> => {
      throw new Error('timeout');
    };
    await expect(fetchDailyBarsWithFallback(async () => { throw banned; }, okxDown, 'BTCUSDT', 400, 0)).rejects.toThrow(
      /IP banned until .* — OKX fallback failed too: timeout/,
    );
  });

  it('rethrows when there is no fallback', async () => {
    await expect(fetchDailyBarsWithFallback(async () => { throw banned; }, null, 'BTCUSDT', 400, 0)).rejects.toBe(banned);
  });
});
