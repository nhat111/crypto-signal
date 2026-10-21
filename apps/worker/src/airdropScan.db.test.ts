import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, getJobHealth, hasTestDatabase, JOB_AIRDROP_SCAN } from '@crypto-signal/db';
import type { Logger } from '@crypto-signal/shared';
import { runAirdropScanCycle } from './airdropScan.js';

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
// Far enough in the future that no real run has stored that day.
const NOW = Date.UTC(2098, 5, 1, 12);

describe.skipIf(!hasTestDatabase)('airdrop scan cycle against real Postgres', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
    await pool.query("DELETE FROM airdrop_candidates WHERE day = '2098-06-01'");
  });
  afterAll(async () => {
    await pool.query("DELETE FROM airdrop_candidates WHERE day = '2098-06-01'");
    await pool.end();
  });

  it('stores only tokenless protocols and records the job as healthy', async () => {
    const source = {
      fetchProtocols: async () => ({
        dropped: 1,
        protocols: [
          { name: 'Fresh', slug: 'test-fresh', symbol: '-', category: 'Dexs', tvl: 40_000_000, chains: ['Base'] },
          { name: 'Old', slug: 'test-old', symbol: 'OLD', category: 'Dexs', tvl: 90_000_000 },
        ],
      }),
    };
    await runAirdropScanCycle({ pool, logger, source, nowMs: NOW, thresholds: { minTvlUsd: 10_000_000, maxCandidates: 50 } });

    // Read by day, not "latest": the db package's tests store far-future days in parallel.
    const { rows } = await pool.query("SELECT slug FROM airdrop_candidates WHERE day = '2098-06-01'");
    expect(rows.map((r) => r.slug)).toEqual(['test-fresh']);
    expect((await getJobHealth(pool, JOB_AIRDROP_SCAN))?.consecutiveFailures).toBe(0);
  });

  it('records a failure when upstream throws', async () => {
    const source = { fetchProtocols: async () => Promise.reject(new Error('boom')) };
    await expect(
      runAirdropScanCycle({ pool, logger, source, nowMs: NOW, thresholds: { minTvlUsd: 1, maxCandidates: 5 } }),
    ).rejects.toThrow('boom');
    expect((await getJobHealth(pool, JOB_AIRDROP_SCAN))?.lastError).toContain('boom');
  });
});
