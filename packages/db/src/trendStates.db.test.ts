import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, hasTestDatabase, lockTestTables } from './testPool.js';
import { claimDailyDigest, getTrendStates, upsertTrendState, type TrendStateInput } from './trendStates.js';

const LOCK = 991_026;
const DAY = 86_400_000;

describe.skipIf(!hasTestDatabase)('trend states against real Postgres', () => {
  let pool: Pool;
  let release: () => Promise<void>;

  beforeAll(async () => {
    pool = createTestPool();
    release = await lockTestTables(pool, LOCK);
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM trend_states WHERE symbol LIKE 'TEST%'");
    await pool.query("DELETE FROM daily_digests WHERE day >= '2099-01-01'");
  });
  afterAll(async () => {
    await pool.query("DELETE FROM trend_states WHERE symbol LIKE 'TEST%'");
    await pool.query("DELETE FROM daily_digests WHERE day >= '2099-01-01'");
    await release();
    await pool.end();
  });

  const input = (day: number, trend: TrendStateInput['trend'], event: TrendStateInput['event'] = null): TrendStateInput => ({
    symbol: 'TESTUSDT',
    lastCloseTime: day * DAY,
    lastClose: 100,
    trend,
    event,
    ema: null,
    emaPeriod: 200,
    aboveEma: null,
    swingHighs: [{ openTime: 0, price: 110 }],
    swingLows: [{ openTime: 0, price: 90 }],
    reasons: ['r'],
  });

  it('records a change once, on the close that made it, and not on hourly re-reads of that close', async () => {
    const first = await upsertTrendState(pool, input(20000, 'up'));
    expect(first).toMatchObject({ newClose: true, labelChanged: false });

    const broke = await upsertTrendState(pool, input(20001, 'sideways', 'up_broken'));
    expect(broke).toMatchObject({ newClose: true, labelChanged: true, newEvent: true });
    expect(broke.row.previousTrend).toBe('up');
    expect(broke.row.changedAt).not.toBeNull();

    const reread = await upsertTrendState(pool, input(20001, 'sideways', 'up_broken'));
    expect(reread).toMatchObject({ newClose: false, labelChanged: false, newEvent: false });
    expect(reread.row.previousTrend).toBe('up');

    const nextDay = await upsertTrendState(pool, input(20002, 'sideways', 'up_broken'));
    expect(nextDay).toMatchObject({ newClose: true, labelChanged: false, newEvent: false });

    const rows = await getTrendStates(pool);
    expect(rows.find((r) => r.symbol === 'TESTUSDT')?.swingLows).toEqual([{ openTime: 0, price: 90 }]);
  });

  it('lets exactly one caller claim a day', async () => {
    expect(await claimDailyDigest(pool, '2099-01-02')).toBe(true);
    expect(await claimDailyDigest(pool, '2099-01-02')).toBe(false);
  });
});
