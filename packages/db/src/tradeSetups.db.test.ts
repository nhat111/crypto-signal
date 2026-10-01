import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, hasTestDatabase, lockTestTables } from './testPool.js';
import { getOpenTradeSetups, getTradeSetupStats, insertTradeSetup, resolveTradeSetup, type NewTradeSetup } from './tradeSetups.js';

const LOCK = 991_027;

describe.skipIf(!hasTestDatabase)('trade setups against real Postgres', () => {
  let pool: Pool;
  let release: () => Promise<void>;
  beforeAll(async () => {
    pool = createTestPool();
    release = await lockTestTables(pool, LOCK);
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM trade_setups');
  });
  afterAll(async () => {
    await pool.query('DELETE FROM trade_setups');
    await release();
    await pool.end();
  });

  const setup = (bar: number, kind: NewTradeSetup['kind'] = 'pullback'): NewTradeSetup => ({
    symbol: 'SOLUSDT', kind, barOpenTime: bar, level: 100, entry: 103, stop: 98, target: 113, rr: 2, atr: 2, reasons: ['r'],
  });

  it('records a setup once per symbol, kind and bar — the hourly re-read is not a new setup', async () => {
    expect(await insertTradeSetup(pool, setup(1_000))).not.toBeNull();
    expect(await insertTradeSetup(pool, setup(1_000))).toBeNull();
    expect(await insertTradeSetup(pool, setup(1_000, 'breakout_retest'))).not.toBeNull();
    expect(await getOpenTradeSetups(pool)).toHaveLength(2);
  });

  it('resolves only open setups and averages R over the resolved ones', async () => {
    const a = (await insertTradeSetup(pool, setup(1)))!;
    const b = (await insertTradeSetup(pool, setup(2)))!;
    await insertTradeSetup(pool, setup(3));
    await resolveTradeSetup(pool, a.id, 'target', 10_000, 2);
    await resolveTradeSetup(pool, b.id, 'stop', 10_000, -1);
    await resolveTradeSetup(pool, b.id, 'target', 20_000, 2); // already resolved: ignored
    const [stats] = await getTradeSetupStats(pool);
    expect(stats).toMatchObject({ kind: 'pullback', total: 3, open: 1, resolved: 2, targets: 1, stops: 1 });
    expect(stats?.avgR).toBeCloseTo(0.5);
  });
});
