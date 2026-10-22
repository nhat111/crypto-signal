import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { CoinRead } from '@crypto-signal/indicators';
import { createTestPool, hasTestDatabase, lockTestTables } from './testPool.js';
import { claimCoinWatchIntraday, getCoinScanForDay, getLatestCoinScan, getLatestCoinScanDay, saveCoinScan } from './coinScan.js';
import { getCoinScanEdge } from './coinScanEdge.js';

const LOCK = 991_028;

function read(symbol: string, overrides: Partial<CoinRead> = {}): CoinRead {
  return {
    symbol,
    lastBarOpenTime: 0,
    close: 100,
    ret7d: 5,
    ret30d: null,
    rs7d: 2.5,
    rs30d: null,
    rsAboveSma20: true,
    downDayExcess: null,
    downDays: 3,
    takerSkew7d: 0.03,
    takerSkew30d: 0.01,
    oiChange7dPct: null,
    fundingAvg7dPct: 0.01,
    spotPerpVolumeRatio: 0.4,
    flow: 'spot_led',
    reasons: ['r1', 'r2'],
    unknowns: ['u1'],
    ...overrides,
  };
}

describe.skipIf(!hasTestDatabase)('coin scan rows against real Postgres', () => {
  let pool: Pool;
  let release: () => Promise<void>;

  beforeAll(async () => {
    pool = createTestPool();
    release = await lockTestTables(pool, LOCK);
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM coin_scan_rows WHERE day >= '2099-01-01'");
  });
  afterAll(async () => {
    await pool.query("DELETE FROM coin_scan_rows WHERE day >= '2099-01-01'");
    await pool.query("DELETE FROM coin_watch_intraday_sent WHERE day >= '2099-01-01'");
    await release();
    await pool.end();
  });

  it('serves the latest day only, most-traded first, with nulls and arrays intact', async () => {
    await saveCoinScan(pool, '2099-01-01', [{ read: read('OLDUSDT'), volumeRank: 1, futuresSymbol: null, spotQuoteVolume24h: 1 }]);
    await saveCoinScan(pool, '2099-01-02', [
      { read: read('SOLUSDT', { flow: 'leverage_led' }), volumeRank: 3, futuresSymbol: 'SOLUSDT', spotQuoteVolume24h: 5e8 },
      { read: read('BTCUSDT', { rs7d: 0 }), volumeRank: 1, futuresSymbol: 'BTCUSDT', spotQuoteVolume24h: 2e9 },
    ]);

    expect(await getLatestCoinScanDay(pool)).toBe('2099-01-02');
    const { day, rows } = await getLatestCoinScan(pool);
    expect(day).toBe('2099-01-02');
    expect(rows.map((r) => r.symbol)).toEqual(['BTCUSDT', 'SOLUSDT']);
    expect(rows[1]).toMatchObject({
      flow: 'leverage_led',
      futuresSymbol: 'SOLUSDT',
      ret30d: null,
      oiChange7dPct: null,
      rsAboveSma20: true,
      reasons: ['r1', 'r2'],
      unknowns: ['u1'],
    });
    expect(rows[0]?.rs7d).toBe(0);
  });

  it('replaces a day wholesale on a re-run, so a coin that left the top N leaves that day too', async () => {
    await saveCoinScan(pool, '2099-01-03', [
      { read: read('AAAUSDT'), volumeRank: 1, futuresSymbol: null, spotQuoteVolume24h: 1 },
      { read: read('BBBUSDT'), volumeRank: 2, futuresSymbol: null, spotQuoteVolume24h: 1 },
    ]);
    await saveCoinScan(pool, '2099-01-03', [{ read: read('AAAUSDT', { close: 200 }), volumeRank: 1, futuresSymbol: null, spotQuoteVolume24h: 1 }]);
    const { rows } = await getLatestCoinScan(pool);
    expect(rows.map((r) => [r.symbol, r.close])).toEqual([['AAAUSDT', 200]]);
    expect(rows[0]?.exchange).toBe('binance');
  });

  it('reads one named day, and nothing for a day that was not scanned', async () => {
    await saveCoinScan(pool, '2099-02-01', [{ read: read('ETHUSDT'), volumeRank: 2, futuresSymbol: null, spotQuoteVolume24h: 1 }]);
    await saveCoinScan(pool, '2099-02-02', [{ read: read('SOLUSDT'), volumeRank: 3, futuresSymbol: null, spotQuoteVolume24h: 1 }]);
    expect((await getCoinScanForDay(pool, '2099-02-01')).map((r) => r.symbol)).toEqual(['ETHUSDT']);
    expect(await getCoinScanForDay(pool, '2099-02-03')).toEqual([]);
  });

  it('feeds the stored days into the edge evaluation, closes and exchanges intact', async () => {
    // 2099-01-08 is day 47487, a multiple of 7: a cohort day on the 7-day grid.
    await saveCoinScan(pool, '2099-01-08', [
      { read: read('BTCUSDT', { close: 100 }), volumeRank: 1, futuresSymbol: null, spotQuoteVolume24h: 1 },
      { read: read('SOLUSDT', { close: 10 }), volumeRank: 2, futuresSymbol: null, spotQuoteVolume24h: 1 },
    ]);
    await saveCoinScan(pool, '2099-01-15', [
      { read: read('BTCUSDT', { close: 110 }), volumeRank: 1, futuresSymbol: null, spotQuoteVolume24h: 1 },
      { read: read('SOLUSDT', { close: 12 }), volumeRank: 2, futuresSymbol: null, spotQuoteVolume24h: 1 },
    ]);
    const binance = (await getCoinScanEdge(pool, 7)).find((r) => r.exchange === 'binance');
    const spot = binance?.flows.find((f) => f.flow === 'spot_led');
    expect(spot?.group.samples).toBeGreaterThanOrEqual(1);
    expect(spot?.group.hitPct).toBe(100);
  });

  it('stores fundamentals whole and reads them back, null when there were none', async () => {
    const fundamentals = { chain: null, protocol: { name: 'uniswap', tvlUsd: 2.6e9, tvlChange7dPct: 3, fees30dUsd: 1.2e8, feesChangePct: -20 }, bull: [], bear: ['Phí giảm'], unknowns: [] };
    await saveCoinScan(pool, '2099-03-01', [
      { read: read('UNIUSDT'), volumeRank: 1, futuresSymbol: null, spotQuoteVolume24h: 1, fundamentals },
      { read: read('XYZUSDT'), volumeRank: 2, futuresSymbol: null, spotQuoteVolume24h: 1 },
    ]);
    const rows = await getCoinScanForDay(pool, '2099-03-01');
    expect(rows[0]?.fundamentals).toEqual(fundamentals);
    expect(rows[1]?.fundamentals).toBeNull();
  });

  it('records which exchange a day was read from', async () => {
    await saveCoinScan(pool, '2099-01-04', [{ read: read('BTCUSDT'), volumeRank: 1, futuresSymbol: 'BTCUSDT', spotQuoteVolume24h: 1 }], 'okx');
    const { rows } = await getLatestCoinScan(pool);
    expect(rows[0]?.exchange).toBe('okx');
  });

  it('claims an intraday finding once per coin, kind and day', async () => {
    await pool.query("DELETE FROM coin_watch_intraday_sent WHERE day >= '2099-01-01'");
    expect(await claimCoinWatchIntraday(pool, '2099-05-01', 'SOLUSDT', 'long_unwind')).toBe(true);
    expect(await claimCoinWatchIntraday(pool, '2099-05-01', 'SOLUSDT', 'long_unwind')).toBe(false);
    expect(await claimCoinWatchIntraday(pool, '2099-05-01', 'SOLUSDT', 'funding_flip')).toBe(true);
    expect(await claimCoinWatchIntraday(pool, '2099-05-02', 'SOLUSDT', 'long_unwind')).toBe(true);
  });
});
