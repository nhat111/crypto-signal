import { afterEach, describe, expect, it, vi } from 'vitest';
import { OkxSpotCandles, toOkxBar, toOkxInstId } from './spotCandles.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function okxResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('toOkxInstId', () => {
  it('splits a Binance symbol on its quote asset', () => {
    expect(toOkxInstId('NEARUSDT')).toBe('NEAR-USDT');
    expect(toOkxInstId('nearusdc')).toBe('NEAR-USDC');
    expect(toOkxInstId('ETHBTC')).toBe('ETH-BTC');
    expect(toOkxInstId('BTCFDUSD')).toBe('BTC-FDUSD');
  });

  it('returns null when no known quote ends the symbol', () => {
    expect(toOkxInstId('USDT')).toBeNull();
    expect(toOkxInstId('NEAR')).toBeNull();
  });
});

describe('OkxSpotCandles.fetchBars', () => {
  it('returns bars oldest first, in Binance units, with UTC daily bars', async () => {
    // Real rows from /api/v5/market/candles, newest first as OKX sends them.
    const fetchMock = vi.fn(async (_url: string) =>
      okxResponse({
        code: '0',
        msg: '',
        data: [
          ['1791590400000', '4.884', '4.903', '4.871', '4.902', '28742.73', '140458.56', '140458.56', '0'],
          ['1791576000000', '4.659', '4.98', '4.655', '4.885', '792388.80', '3862123.95', '3862123.95', '1'],
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const bars = await new OkxSpotCandles({ logger }).fetchBars('NEARUSDT', '4h', 200);
    expect(bars.map((b) => b.openTime)).toEqual([1791576000000, 1791590400000]);
    expect(bars[0]).toEqual({ openTime: 1791576000000, open: 4.659, high: 4.98, low: 4.655, close: 4.885, volume: 792388.8 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('instId=NEAR-USDT&bar=4H&limit=200');

    await new OkxSpotCandles({ logger }).fetchBars('NEARUSDT', '1d', 500);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('bar=1Dutc&limit=300');
  });

  it('returns no bars for a pair OKX does not list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okxResponse({ code: '51001', msg: "Instrument ID doesn't exist.", data: [] })),
    );
    await expect(new OkxSpotCandles({ logger }).fetchBars('NOTAREALUSDT', '4h', 200)).resolves.toEqual([]);
  });

  it('throws on any other OKX error code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okxResponse({ code: '50011', msg: 'Too Many Requests', data: [] })));
    await expect(new OkxSpotCandles({ logger }).fetchBars('NEARUSDT', '4h', 200)).rejects.toThrow(/50011/);
  });

  it('asks nothing for a timeframe or symbol it cannot map', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new OkxSpotCandles({ logger }).fetchBars('NEARUSDT', '3m', 200)).resolves.toEqual([]);
    await expect(new OkxSpotCandles({ logger }).fetchBars('NEAR', '4h', 200)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('OkxSpotCandles.fetchClosedDailyBars', () => {
  const DAY = 86_400_000;
  const row = (openTime: number) => [String(openTime), '1', '2', '0.5', '1.5', '10', '0', '0', '1'];
  // Newest first, like OKX.
  const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => row((to - i) * DAY));

  it('pages back through history-candles for more than 300 days and drops the forming day', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/market/candles?')) return okxResponse({ code: '0', msg: '', data: days(100, 400) });
      const after = Number(/after=(\d+)/.exec(url)?.[1]) / DAY;
      return okxResponse({ code: '0', msg: '', data: days(Math.max(0, after - 100), after - 1) });
    });
    vi.stubGlobal('fetch', fetchMock);

    // Day 400 is still forming at this `now`.
    const bars = await new OkxSpotCandles({ logger }).fetchClosedDailyBars('BTCUSDT', 350, 400 * DAY + 1000);
    expect(bars).toHaveLength(350);
    expect(bars[0]?.openTime).toBe(50 * DAY);
    expect(bars.at(-1)?.openTime).toBe(399 * DAY);
    expect(bars.at(-1)?.closeTime).toBe(400 * DAY - 1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('bar=1Dutc&limit=300');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(`history-candles?instId=BTC-USDT&bar=1Dutc&limit=100&after=${100 * DAY}`);
  });

  it('stops paging when history runs out', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      okxResponse({ code: '0', msg: '', data: url.includes('/market/candles?') ? days(0, 10) : [] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const bars = await new OkxSpotCandles({ logger }).fetchClosedDailyBars('BTCUSDT', 400, 20 * DAY);
    expect(bars).toHaveLength(11);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('toOkxBar', () => {
  it('drops a row with a non-numeric field rather than inventing a value', () => {
    expect(toOkxBar(['1', 'x', '1', '1', '1', '1'])).toBeNull();
    expect(toOkxBar(['1', '1', '1'])).toBeNull();
  });
});
