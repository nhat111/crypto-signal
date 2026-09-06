import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { GEM_TABLES_LOCK, createTestPool, hasTestDatabase, lockTestTables } from './testPool.js';
import { getGemChainHealth, recordGemChainScan } from './gems.js';

/**
 * The streak is the diagnosis, and it only exists across scans — so it has
 * to be right in SQL, where a fake pool would prove nothing.
 */
describe.skipIf(!hasTestDatabase)('gem chain health against real Postgres', () => {
  let pool: Pool;
  let releaseLock: () => Promise<void>;

  const scan = (chainId: string, candidateCount: number, sources: Record<string, number | 'unsupported'> = {}) =>
    recordGemChainScan(pool, {
      chainId,
      scannedAt: Date.now(),
      candidateCount,
      eligibleCount: candidateCount > 0 ? 1 : 0,
      sources,
    });

  beforeAll(async () => {
    pool = createTestPool();
    releaseLock = await lockTestTables(pool, GEM_TABLES_LOCK);
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM gem_chain_health');
  });
  afterAll(async () => {
    await releaseLock();
    await pool.end();
  });

  it('reports nothing before the scanner has run', async () => {
    expect(await getGemChainHealth(pool)).toEqual([]);
  });

  it('counts consecutive empty scans across passes', async () => {
    // The whole point: one empty scan is a quiet half hour, a streak is a
    // configuration that cannot work. Only the accumulated count separates
    // them, and it has to survive across calls.
    await scan('solana', 0);
    await scan('solana', 0);
    await scan('solana', 0);
    const [row] = await getGemChainHealth(pool);
    expect(row?.consecutiveEmptyScans).toBe(3);
  });

  it('resets the streak the moment something is found', async () => {
    await scan('solana', 0);
    await scan('solana', 0);
    await scan('solana', 7);
    const [row] = await getGemChainHealth(pool);
    expect(row?.consecutiveEmptyScans).toBe(0);
    expect(row?.candidateCount).toBe(7);
  });

  it('keeps a source that does not cover the chain distinct from one that found none', async () => {
    // Two different fixes — a missing mapping versus the market — and the
    // string has to survive the JSONB round trip to say which.
    await scan('hyperevm', 0, { dexscreener: 0, geckoterminal: 'unsupported' });
    const [row] = await getGemChainHealth(pool);
    expect(row?.sources).toEqual({ dexscreener: 0, geckoterminal: 'unsupported' });
  });

  it('keeps one row per chain rather than a history', async () => {
    await scan('solana', 1);
    await scan('solana', 2);
    await scan('base', 3);
    const rows = await getGemChainHealth(pool);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.chainId)).toEqual(['base', 'solana']);
    expect(rows.find((r) => r.chainId === 'solana')?.candidateCount).toBe(2);
  });

  it('tracks each chain’s streak independently', async () => {
    // One broken chain must not make a working one look broken.
    await scan('solana', 5);
    await scan('hyperevm', 0);
    await scan('solana', 5);
    await scan('hyperevm', 0);
    const rows = await getGemChainHealth(pool);
    expect(rows.find((r) => r.chainId === 'solana')?.consecutiveEmptyScans).toBe(0);
    expect(rows.find((r) => r.chainId === 'hyperevm')?.consecutiveEmptyScans).toBe(2);
  });
});
