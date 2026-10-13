import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { CoinRead } from '@crypto-signal/indicators';
import { createTestPool, hasTestDatabase, lockTestTables } from './testPool.js';
import { getLatestCoinScan, getLatestCoinScanDay, saveCoinScan } from './coinScan.js';

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
  });
});
