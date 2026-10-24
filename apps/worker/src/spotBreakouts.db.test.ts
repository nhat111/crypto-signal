import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, getLatestSpotBreakoutRun, getOpenSpotBreakouts, getRecentClosedSpotBreakouts, hasTestDatabase, JOB_SPOT_BREAKOUTS } from '@crypto-signal/db';
import type { OhlcvBar } from '@crypto-signal/indicators';
import type { WorkerContext } from './context.js';
import { runSpotBreakoutCycle, type FetchDaily } from './spotBreakouts.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2099, 0, 1);
const bar = (i: number, o: number, h: number, l: number, c: number): OhlcvBar => ({ openTime: T0 + i * DAY, open: o, high: h, low: l, close: c, volume: 1 });
const rising = (n: number, from: number) => Array.from({ length: n }, (_, i) => bar(i, from + i * 0.1, from + i * 0.1 + 1, from + i * 0.1 - 1, from + i * 0.1));
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe.skipIf(!hasTestDatabase)('spot breakout cycle against real Postgres', () => {
  let pool: Pool;
  const ctx = () =>
    ({ pool, logger, config: { spotBreakouts: { enabled: true, symbols: ['ZZTESTAUSDT', 'ZZTESTBUSDT'] } } }) as unknown as WorkerContext;
  const clear = async () => {
    await pool.query("DELETE FROM spot_breakouts WHERE symbol LIKE 'ZZTEST%'");
    await pool.query('DELETE FROM job_health WHERE job_name = $1', [JOB_SPOT_BREAKOUTS]);
    await pool.query("DELETE FROM spot_breakout_runs WHERE day >= '2099-01-01'");
  };

  beforeAll(async () => {
    pool = createTestPool();
    await clear();
  });
  afterAll(async () => {
    await clear();
    await pool.end();
  });

  it('enters a breakout only while BTC is up, follows it, and runs once a day', async () => {
    const btc = rising(241, 100);
    const base = rising(240, 50);
    const high = Math.max(...base.slice(-20).map((b) => b.high));
    const breakout = bar(240, high, high + 3, high - 0.5, high + 2);
    const series: Record<string, OhlcvBar[]> = {
      BTCUSDT: btc,
      ZZTESTAUSDT: [...base, breakout],
      ZZTESTBUSDT: rising(241, 50), // no close above its 20-day high
    };
    const fetch: FetchDaily = async (s) => series[s] ?? [];
    // Bars live in 2099; the clock is real, because the once-a-day check compares it with the database's now().
    const now = Date.now();

    await runSpotBreakoutCycle(ctx(), now, fetch);
    const open = (await getOpenSpotBreakouts(pool)).filter((p) => p.symbol.startsWith('ZZTEST'));
    expect(open.map((p) => p.symbol)).toEqual(['ZZTESTAUSDT']);
    expect(open[0]).toMatchObject({ entry: high + 2, exchange: 'okx', status: 'open' });
    expect(await getLatestSpotBreakoutRun(pool)).toMatchObject({ day: '2099-08-29', regimeUp: true, coinsRead: 2, found: 1, closed: 0 });

    // A second tick the same day does nothing, even with a crash in the bars.
    series['ZZTESTAUSDT'] = [...base, breakout, bar(241, high, high, 1, 2)];
    await runSpotBreakoutCycle(ctx(), now, fetch);
    expect((await getOpenSpotBreakouts(pool)).some((p) => p.symbol === 'ZZTESTAUSDT')).toBe(true);

    // Next day (job record cleared to stand in for the date changing): the crash is the stop.
    await pool.query('DELETE FROM job_health WHERE job_name = $1', [JOB_SPOT_BREAKOUTS]);
    series['BTCUSDT'] = rising(242, 100);
    await runSpotBreakoutCycle(ctx(), now, fetch);
    const [closed] = (await getRecentClosedSpotBreakouts(pool, 50)).filter((p) => p.symbol === 'ZZTESTAUSDT');
    expect(closed).toMatchObject({ status: 'stop', exitPrice: open[0]!.stop });
    expect(closed!.rMultiple).toBeLessThan(-1);
  });

  it('enters nothing while BTC is down', async () => {
    await clear();
    const base = rising(240, 50);
    const high = Math.max(...base.slice(-20).map((b) => b.high));
    const series: Record<string, OhlcvBar[]> = {
      BTCUSDT: rising(241, 200).map((b, i) => ({ ...b, close: 200 - i * 0.2, high: 201 - i * 0.2, low: 199 - i * 0.2, open: 200 - i * 0.2 })),
      ZZTESTAUSDT: [...base, bar(240, high, high + 3, high - 0.5, high + 2)],
    };
    await runSpotBreakoutCycle(ctx(), Date.now(), async (s) => series[s] ?? []);
    expect((await getOpenSpotBreakouts(pool)).filter((p) => p.symbol.startsWith('ZZTEST'))).toEqual([]);
  });
});
