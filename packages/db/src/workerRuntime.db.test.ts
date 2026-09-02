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
});
