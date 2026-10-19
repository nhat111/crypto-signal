import { describe, expect, it } from 'vitest';
import type { CoinDailyBar, Ticker24h } from '@crypto-signal/indicators';
import { BinanceRestError } from '@crypto-signal/market-data';
import type { CoinScanConfig } from '@crypto-signal/shared';
import type { OkxCoinScanData } from '@crypto-signal/market-data';
import { lastClosedDay, okxCoinScanSource, scanCoins, scanSymbol, scanWithFallback, type CoinScanSource, type OiVenue } from './coinScan.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 13, 3); // 13/10 03:00 UTC — the 12/10 bar is the last closed one
const CONFIG: CoinScanConfig = {
  enabled: true,
  topN: 10,
  thresholds: { priceMovePct: 3, takerSkew: 0.02, oiRisePct: 10, oiFallPct: -10, fundingElevatedPct: 0.03, fundingShortsPayPct: -0.005 },
  setups: true,
  watchlistSize: 6,
  oiVenues: [],
};

function bars(n: number, daily: number, lastOpen = Date.UTC(2026, 9, 12)): CoinDailyBar[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: lastOpen - (n - 1 - i) * DAY,
    close: 100 * (1 + daily) ** i,
    quoteVolume: 1000,
    takerBuyQuoteVolume: 520,
  }));
}

const ticker = (symbol: string, quoteVolume: number): Ticker24h => ({ symbol, quoteVolume, lastPrice: 1, closeTime: NOW - 60_000 });

function source(overrides: Partial<CoinScanSource> = {}): CoinScanSource & { calls: string[] } {
  const calls: string[] = [];
  const byCoin: Record<string, CoinDailyBar[]> = {
    BTCUSDT: bars(62, 0.005),
    ETHUSDT: bars(62, 0.01),
    USD1USDT: bars(62, 0),
    PEGUSDT: bars(62, 0.0001),
    NEWUSDT: bars(5, 0.02),
    LATEUSDT: bars(62, 0.01, Date.UTC(2026, 9, 11)),
  };
  return {
    calls,
    spotTickers: async () => ['BTCUSDT', 'ETHUSDT', 'USD1USDT', 'PEGUSDT', 'NEWUSDT', 'LATEUSDT'].map((s, i) => ticker(s, 1000 - i)),
    futuresTickers: async () => [ticker('BTCUSDT', 5000), ticker('ETHUSDT', 4000), ticker('NEWUSDT', 10)],
    dailyBars: async (symbol) => {
      calls.push(`bars:${symbol}`);
      return byCoin[symbol] ?? [];
    },
    dailyOpenInterest: async (symbol) => {
      calls.push(`oi:${symbol}`);
      return { coins: [100, 100, 100, 100, 100, 100, 100, 120], venues: ['binance', 'gate'] };
    },
    funding7d: async (symbol) => {
      calls.push(`funding:${symbol}`);
      return Array.from({ length: 21 }, () => 0.0001);
    },
    ...overrides,
  };
}

describe('lastClosedDay', () => {
  it('is yesterday in UTC, whatever the hour', () => {
    expect(lastClosedDay(NOW)).toBe('2026-10-12');
    expect(lastClosedDay(Date.UTC(2026, 9, 13, 0, 0, 1))).toBe('2026-10-12');
    expect(lastClosedDay(Date.UTC(2026, 9, 12, 23, 59))).toBe('2026-10-11');
  });
});

describe('scanCoins', () => {
  it('reads every coin it can and says why it skipped the rest', async () => {
    const src = source();
    const result = await scanCoins(src, CONFIG, NOW);
    expect(result.day).toBe('2026-10-12');
    expect(result.inputs.map((i) => i.read.symbol)).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(result.skipped).toEqual([
      'PEGUSDT: pegged (30-day range under 2%)',
      'NEWUSDT: under a week of history',
      'LATEUSDT: no closed bar for 2026-10-12',
    ]);
    // USD1 is a stablecoin by name and never fetched; BTC's bars are read once.
    expect(src.calls.filter((c) => c === 'bars:BTCUSDT')).toHaveLength(1);
    expect(src.calls).not.toContain('bars:USD1USDT');
    // Too short to read, so its leverage is never asked for.
    expect(src.calls).not.toContain('oi:NEWUSDT');
    const eth = result.inputs[1]?.read;
    expect(eth?.oiChange7dPct).toBeCloseTo(20, 9);
    expect(eth?.flow).toBe('spot_and_leverage');
    expect(result.inputs[1]?.futuresSymbol).toBe('ETHUSDT');
    // BTC and ETH both had a perp, so both venues were summed into both.
    expect(result.oiVenues).toEqual({ binance: 2, gate: 2 });
  });

  it('keeps the spot read when the futures market refuses the server, and says so per coin', async () => {
    const ban = new BinanceRestError('banned', 418, undefined);
    const src = source({ futuresTickers: async () => Promise.reject(ban) });
    const result = await scanCoins(src, CONFIG, NOW);
    expect(result.inputs.map((i) => i.read.symbol)).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(src.calls.some((c) => c.startsWith('oi:') || c.startsWith('funding:'))).toBe(false);
    expect(result.inputs[1]?.read.unknowns.join(' ')).toContain('không đọc được thị trường futures');
  });

  it('treats a region block on futures (451) like a ban, not as a failed scan', async () => {
    const blocked = new BinanceRestError('restricted location', 451, undefined);
    const result = await scanCoins(source({ futuresTickers: async () => Promise.reject(blocked) }), CONFIG, NOW);
    expect(result.inputs).toHaveLength(2);
  });

  it('stops asking futures after a ban mid-scan instead of lengthening it', async () => {
    const ban = new BinanceRestError('banned', 418, undefined);
    const src = source({ dailyOpenInterest: async () => Promise.reject(ban) });
    const result = await scanCoins(src, CONFIG, NOW);
    expect(result.inputs).toHaveLength(2);
    expect(result.skipped.filter((s) => s.includes('futures read failed'))).toHaveLength(1);
  });

  it('gives up on a spot ban rather than storing a scan of nothing', async () => {
    const ban = new BinanceRestError('banned', 418, undefined);
    let n = 0;
    const src = source({
      dailyBars: async (symbol) => {
        n += 1;
        if (n > 1) throw ban;
        return symbol === 'BTCUSDT' ? bars(62, 0.005) : [];
      },
    });
    await expect(scanCoins(src, CONFIG, NOW)).rejects.toBe(ban);
  });
});

describe('scanWithFallback', () => {
  const ban = new BinanceRestError('banned', 418, undefined);

  it('reads Binance when Binance answers, and never asks OKX', async () => {
    const okx = source({ spotTickers: async () => Promise.reject(new Error('should not be called')) });
    const out = await scanWithFallback(source(), okx, CONFIG, NOW);
    expect(out.exchange).toBe('binance');
    expect(out.binanceError).toBeNull();
    expect(okx.calls).toEqual([]);
  });

  it('reads the whole day from OKX when Binance refuses the server', async () => {
    const okx = source();
    const out = await scanWithFallback(source({ spotTickers: async () => Promise.reject(ban) }), okx, CONFIG, NOW);
    expect(out.exchange).toBe('okx');
    expect(out.binanceError).toContain('banned');
    expect(out.result.inputs.map((i) => i.read.symbol)).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('does not paper over a Binance answer that is wrong rather than refused', async () => {
    const broken = new Error('unexpected shape');
    await expect(scanWithFallback(source({ spotTickers: async () => Promise.reject(broken) }), source(), CONFIG, NOW)).rejects.toBe(broken);
  });

  it('names both failures when OKX fails too', async () => {
    const out = scanWithFallback(
      source({ spotTickers: async () => Promise.reject(ban) }),
      source({ spotTickers: async () => Promise.reject(new Error('OKX 50011: too many requests')) }),
      CONFIG,
      NOW,
    );
    await expect(out).rejects.toThrow(/banned — OKX fallback failed too: OKX 50011/);
  });
});

describe('scanSymbol', () => {
  it('turns journal tickers into scan symbols, leaving addresses alone', () => {
    expect(scanSymbol('bat')).toBe('BATUSDT');
    expect(scanSymbol(' BATUSDT ')).toBe('BATUSDT');
    expect(scanSymbol('1000PEPE')).toBe('1000PEPEUSDT');
    expect(scanSymbol('0xAbC123def4567890abc')).toBe('0xAbC123def4567890abc');
  });
});

describe('summed open interest', () => {
  const day = (i: number): number => Date.UTC(2026, 9, 4) + i * DAY;
  const series = (values: number[]) => values.map((coins, i) => ({ time: day(i), coins }));
  const okx = (read: () => Promise<Array<{ time: number; coins: number }>>) => ({ dailyOpenInterest: read }) as unknown as OkxCoinScanData;
  const venue = (name: string, read: OiVenue['dailyOpenInterest']): OiVenue => ({ name, dailyOpenInterest: read });

  it('adds the other venues to the scan exchange and leaves out one that fails', async () => {
    const src = okxCoinScanSource(okx(async () => series([10, 10, 10, 10, 10, 10, 10, 10, 10])), [
      venue('bybit', async (base) => (base === 'ETH' ? series([5, 5, 5, 5, 5, 5, 5, 5, 15]) : [])),
      venue('gate', async () => Promise.reject(new Error('HTTP 400'))),
    ]);
    const oi = await src.dailyOpenInterest('ETHUSDT', 'ETH');
    expect(oi.venues).toEqual(['okx', 'bybit']);
    expect(oi.coins).toHaveLength(8);
    // 15 → 25: the change Bybit's longs added, which OKX alone would read as flat.
    expect(oi.coins[0]).toBe(15);
    expect(oi.coins[7]).toBe(25);
  });

  it('still throws when the scan exchange itself fails, so a ban stops futures reads', async () => {
    const ban = new BinanceRestError('banned', 418, undefined);
    const src = okxCoinScanSource(okx(async () => Promise.reject(ban)), [venue('bybit', async () => series([1]))]);
    await expect(src.dailyOpenInterest('ETHUSDT', 'ETH')).rejects.toBe(ban);
  });

  it('asks no other venue for a coin the scan exchange has no OI for', async () => {
    let asked = 0;
    const src = okxCoinScanSource(okx(async () => []), [
      venue('bybit', async () => {
        asked += 1;
        return series([1]);
      }),
    ]);
    expect(await src.dailyOpenInterest('ETHUSDT', 'ETH')).toEqual({ coins: [], venues: [] });
    expect(asked).toBe(0);
  });
});
