import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, hasTestDatabase, lockTestTables } from './testPool.js';
import { getOpenTradeSetups, getRecentTradeSetups, getSetupBtcTrendStats, getTradeSetupStats, insertTradeSetup, resolveTradeSetup, type NewTradeSetup } from './tradeSetups.js';

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

  it('stores which exchange found a setup, Binance unless told otherwise', async () => {
    expect((await insertTradeSetup(pool, setup(5)))?.exchange).toBe('binance');
    expect((await insertTradeSetup(pool, { ...setup(6), exchange: 'okx' }))?.exchange).toBe('okx');
    expect((await getOpenTradeSetups(pool)).map((s) => s.exchange).sort()).toEqual(['binance', 'okx']);
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

  it('stores the cohort and its context, core unless told otherwise, and filters recent setups by cohort', async () => {
    const context = { scanDay: '2026-10-13', rs30d: 54.5, flow: 'leverage_led' };
    expect(await insertTradeSetup(pool, setup(1))).toMatchObject({ cohort: 'core', context: null });
    expect(await insertTradeSetup(pool, { ...setup(2), symbol: 'OPUSDT', cohort: 'watchlist', context })).toMatchObject({ cohort: 'watchlist', context });
    await insertTradeSetup(pool, { ...setup(3), symbol: 'LTCUSDT', cohort: 'scan', context });
    expect((await getRecentTradeSetups(pool, 10)).map((s) => s.cohort).sort()).toEqual(['core', 'scan', 'watchlist']);
    expect((await getRecentTradeSetups(pool, 10, ['core', 'watchlist'])).map((s) => s.symbol).sort()).toEqual(['OPUSDT', 'SOLUSDT']);
    expect((await getTradeSetupStats(pool)).map((s) => `${s.cohort}/${s.kind}/${s.total}`)).toEqual(['core/pullback/1', 'scan/pullback/1', 'watchlist/pullback/1']);
  });

  it("stores BTC's trend and splits resolved setups by it, leaving out BTC itself, open setups and unknown trends", async () => {
    expect(await insertTradeSetup(pool, setup(1))).toMatchObject({ btcTrend: null });
    const down = (await insertTradeSetup(pool, { ...setup(2), symbol: 'OPUSDT', btcTrend: 'down' }))!;
    const up = (await insertTradeSetup(pool, { ...setup(3), symbol: 'LTCUSDT', btcTrend: 'up' }))!;
    const side = (await insertTradeSetup(pool, { ...setup(4), symbol: 'LTCUSDT', btcTrend: 'sideways' }))!;
    const btc = (await insertTradeSetup(pool, { ...setup(5), symbol: 'BTCUSDT', btcTrend: 'up' }))!;
    await insertTradeSetup(pool, { ...setup(6), symbol: 'ADAUSDT', btcTrend: 'down' }); // still open
    expect(down.btcTrend).toBe('down');
    await resolveTradeSetup(pool, down.id, 'stop', 10_000, -1);
    await resolveTradeSetup(pool, up.id, 'target', 10_000, 2);
    await resolveTradeSetup(pool, side.id, 'stop', 10_000, -1);
    await resolveTradeSetup(pool, btc.id, 'target', 10_000, 2);
    const stats = await getSetupBtcTrendStats(pool);
    expect(stats.btcDown).toEqual({ resolved: 1, targets: 0, hitPct: 0, avgR: -1 });
    expect(stats.btcNotDown).toMatchObject({ resolved: 2, targets: 1, hitPct: 50 });
    expect(stats.btcNotDown.avgR).toBeCloseTo(0.5);
  });
});
