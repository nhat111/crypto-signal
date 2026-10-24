import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, hasTestDatabase } from './testPool.js';
import {
  closeSpotBreakout,
  getOpenSpotBreakouts,
  getRecentClosedSpotBreakouts,
  getSpotBreakoutStats,
  insertSpotBreakout,
  updateSpotBreakoutTrail,
} from './spotBreakouts.js';

const DAY = 86_400_000;
// Far-future bars and test-only symbols, so a shared database keeps its real rows.
const T0 = Date.UTC(2099, 0, 1);

describe.skipIf(!hasTestDatabase)('spot breakout storage against real Postgres', () => {
  let pool: Pool;
  const clear = () => pool.query("DELETE FROM spot_breakouts WHERE symbol LIKE 'ZZTEST%'");

  beforeAll(async () => {
    pool = createTestPool();
    await clear();
  });
  afterAll(async () => {
    await clear();
    await pool.end();
  });

  it('holds one open position per coin and follows it to its exit', async () => {
    const first = await insertSpotBreakout(pool, { symbol: 'ZZTESTUSDT', exchange: 'okx', barOpenTime: T0, entry: 100, stop: 90, high20: 98 });
    expect(first).toMatchObject({ status: 'open', trail: 90, entry: 100 });
    // Same day again, or another day while it is open: nothing new.
    expect(await insertSpotBreakout(pool, { symbol: 'ZZTESTUSDT', exchange: 'okx', barOpenTime: T0, entry: 100, stop: 90, high20: 98 })).toBeNull();
    expect(await insertSpotBreakout(pool, { symbol: 'ZZTESTUSDT', exchange: 'okx', barOpenTime: T0 + DAY, entry: 105, stop: 95, high20: 103 })).toBeNull();

    await updateSpotBreakoutTrail(pool, first!.id, 95);
    await updateSpotBreakoutTrail(pool, first!.id, 92); // never lowered
    expect((await getOpenSpotBreakouts(pool)).find((r) => r.id === first!.id)?.trail).toBe(95);

    await closeSpotBreakout(pool, first!.id, { status: 'trail', trail: 110, exitPrice: 112, exitTime: T0 + 20 * DAY, returnPct: 11.8, rMultiple: 1.18 });
    const [closed] = (await getRecentClosedSpotBreakouts(pool, 50)).filter((r) => r.symbol === 'ZZTESTUSDT');
    expect(closed).toMatchObject({ status: 'trail', exitPrice: 112, exitTime: T0 + 20 * DAY, rMultiple: 1.18, trail: 110 });

    // Closed, so the coin can break out again.
    expect(await insertSpotBreakout(pool, { symbol: 'ZZTESTUSDT', exchange: 'okx', barOpenTime: T0 + 30 * DAY, entry: 120, stop: 110, high20: 118 })).not.toBeNull();
    const stats = await getSpotBreakoutStats(pool);
    expect(stats.closed).toBeGreaterThanOrEqual(1);
    expect(stats.wins).toBeGreaterThanOrEqual(1);
  });
});
