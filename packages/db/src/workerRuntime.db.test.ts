import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, hasTestDatabase } from './testPool.js';
import { getWorkerRuntime, recordWorkerHeartbeat, RUNTIME_WORKER } from './workerRuntime.js';

describe.skipIf(!hasTestDatabase)('worker heartbeat against real Postgres', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
    await pool.query('DELETE FROM worker_runtime');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('is null before the worker has ever reported', async () => {
    // A cold start has to be distinguishable from a dead worker.
    expect(await getWorkerRuntime(pool)).toBeNull();
  });

  it('stores socket states and per-symbol ingest times', async () => {
    await recordWorkerHeartbeat(
      pool,
      RUNTIME_WORKER,
      { spot: 'open', futures: 'open', liquidation: 'connecting' },
      { BTCUSDT: 1_788_000_000_000 },
    );
    const row = await getWorkerRuntime(pool);
    expect(row?.connections).toEqual({ spot: 'open', futures: 'open', liquidation: 'connecting' });
    expect(row?.symbolIngest).toEqual({ BTCUSDT: 1_788_000_000_000 });
    expect(row?.ageMs).toBeLessThan(5_000);
  });

  it('overwrites in place rather than accumulating rows', async () => {
    await recordWorkerHeartbeat(pool, RUNTIME_WORKER, { spot: 'closed', futures: 'open', liquidation: 'open' });
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM worker_runtime');
    expect(rows[0].n).toBe(1);
    expect((await getWorkerRuntime(pool))?.connections.spot).toBe('closed');
  });

  it('ages the row against a supplied clock, so staleness is testable', async () => {
    const row = await getWorkerRuntime(pool, RUNTIME_WORKER, Date.now() + 10 * 60_000);
    expect(row!.ageMs).toBeGreaterThan(9 * 60_000);
  });

  it('reports how many chats it could alert, so silence can be interpreted', async () => {
    // Without this, "no Telegram message last night" reads as "nothing
    // broke" when it may only mean the alerter was never switched on.
    await recordWorkerHeartbeat(pool, RUNTIME_WORKER, { spot: 'open', futures: 'open', liquidation: 'open' }, {}, 2);
    expect((await getWorkerRuntime(pool))?.alertChatCount).toBe(2);
  });

  it('reports zero rather than nothing when the alerter is off', async () => {
    // Zero is a fact the status page must be able to state out loud, not
    // an absence it should skip over.
    await recordWorkerHeartbeat(pool, RUNTIME_WORKER, { spot: 'open', futures: 'open', liquidation: 'open' }, {}, 0);
    expect((await getWorkerRuntime(pool))?.alertChatCount).toBe(0);
  });

  it('does not carry a previous arming forward on the next beat', async () => {
    // The count is republished every minute; a heartbeat that kept the old
    // value would keep claiming alerts are armed after they were removed.
    await recordWorkerHeartbeat(pool, RUNTIME_WORKER, { spot: 'open', futures: 'open', liquidation: 'open' }, {}, 3);
    await recordWorkerHeartbeat(pool, RUNTIME_WORKER, { spot: 'open', futures: 'open', liquidation: 'open' }, {});
    expect((await getWorkerRuntime(pool))?.alertChatCount).toBe(0);
  });

  it('publishes which timeframes may push an alert', async () => {
    // The reason this column exists: /status could say alerting was armed
    // and to how many chats, but not which frames may fire — so "did
    // ALERT_TIMEFRAMES take effect?" needed a deploy log to answer.
    await recordWorkerHeartbeat(
      pool,
      RUNTIME_WORKER,
      { spot: 'open', futures: 'open', liquidation: 'open' },
      {},
      1,
      { armed: ['1h', '4h'], collected: ['5m', '15m', '1h', '4h'], ignored: ['1d'] },
    );
    const row = await getWorkerRuntime(pool);
    expect(row?.alertTimeframes).toEqual({
      armed: ['1h', '4h'],
      collected: ['5m', '15m', '1h', '4h'],
      ignored: ['1d'],
    });
  });

  it('reports null rather than an empty report when the worker sends none', async () => {
    // A worker predating the field says nothing, which is different from
    // "no frames are armed" — and the page keys off exactly that
    // difference to decide whether to render the row at all.
    await recordWorkerHeartbeat(pool, RUNTIME_WORKER, { spot: 'open', futures: 'open', liquidation: 'open' });
    expect((await getWorkerRuntime(pool))?.alertTimeframes).toBeNull();
  });

  it('replaces the report rather than merging into the old one', async () => {
    // Narrowing the list must actually narrow it on the page; a merge
    // would leave a frame showing as armed after it was removed.
    const beat = (armed: string[]) =>
      recordWorkerHeartbeat(
        pool,
        RUNTIME_WORKER,
        { spot: 'open', futures: 'open', liquidation: 'open' },
        {},
        1,
        { armed, collected: ['5m', '15m', '1h', '4h'], ignored: [] },
      );
    await beat(['5m', '15m', '1h', '4h']);
    await beat(['4h']);
    expect((await getWorkerRuntime(pool))?.alertTimeframes?.armed).toEqual(['4h']);
  });
});
