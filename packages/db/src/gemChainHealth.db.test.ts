import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { GEM_TABLES_LOCK, createTestPool, hasTestDatabase, lockTestTables } from './testPool.js';
import { SECURITIES_SAMPLE_LIMIT, getGemChainHealth, recordGemChainScan } from './gems.js';

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

describe.skipIf(!hasTestDatabase)('the tokenized-security audit sample against real Postgres', () => {
  let pool: Pool;
  let releaseLock: () => Promise<void>;

  const scanWith = (
    chainId: string,
    sample: Array<{ symbol: string; name: string; signal: string }>,
    filtered = sample.length,
  ) =>
    recordGemChainScan(pool, {
      chainId,
      scannedAt: Date.now(),
      candidateCount: 10,
      eligibleCount: 1,
      sources: { dexscreener: 10 },
      securitiesFiltered: filtered,
      securitiesSample: sample,
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

  it('round-trips the names and the rule that caught each one', async () => {
    // The audit only works if the reason survives storage — a list of
    // symbols with no rule attached cannot tell a good catch from a bad one.
    await scanWith('robinhood', [
      { symbol: 'GLD', name: 'SPDR Gold Trust', signal: 'fund issuer "spdr"' },
      { symbol: 'SPCX', name: 'Space Exploration Technologies Corp.', signal: 'corporate suffix "corp"' },
    ]);

    const [row] = await getGemChainHealth(pool);
    expect(row?.securitiesFiltered).toBe(2);
    expect(row?.securitiesSample).toEqual([
      { symbol: 'GLD', name: 'SPDR Gold Trust', signal: 'fund issuer "spdr"' },
      { symbol: 'SPCX', name: 'Space Exploration Technologies Corp.', signal: 'corporate suffix "corp"' },
    ]);
  });

  it('caps the stored sample while keeping the true count', async () => {
    // A chain of hundreds of wrappers must not put hundreds of rows in one
    // JSONB column, but the count has to stay honest or the page would say
    // the filter did less than it did.
    const many = Array.from({ length: 12 }, (_, i) => ({
      symbol: `S${i}`,
      name: `Thing ${i} Inc`,
      signal: 'corporate suffix "inc"',
    }));
    await scanWith('robinhood', many);

    const [row] = await getGemChainHealth(pool);
    expect(row?.securitiesFiltered).toBe(12);
    expect(row?.securitiesSample).toHaveLength(SECURITIES_SAMPLE_LIMIT);
    expect(row?.securitiesSample[0]?.symbol).toBe('S0');
  });

  it('reads a pre-existing row written before the column existed as zero, not as unknown', async () => {
    // The migration backfills a default, so an old row is genuinely "the
    // filter removed nothing" — there was no filter. Anything else would
    // put a phantom warning on a chain that never ran it.
    await pool.query(
      `INSERT INTO gem_chain_health (chain_id, last_scan_at, candidate_count, eligible_count, sources)
       VALUES ('solana', now(), 5, 1, '{}'::jsonb)`,
    );

    const [row] = await getGemChainHealth(pool);
    expect(row?.securitiesFiltered).toBe(0);
    expect(row?.securitiesSample).toEqual([]);
  });

  it('replaces the sample each scan rather than accumulating it', async () => {
    // It is a spot check on the latest scan; a growing list would be a log,
    // and nothing prunes it.
    await scanWith('robinhood', [{ symbol: 'GLD', name: 'SPDR Gold Trust', signal: 'fund issuer "spdr"' }]);
    await scanWith('robinhood', [{ symbol: 'TSLA', name: 'Tesla Inc', signal: 'corporate suffix "inc"' }]);

    const [row] = await getGemChainHealth(pool);
    expect(row?.securitiesFiltered).toBe(1);
    expect(row?.securitiesSample.map((s) => s.symbol)).toEqual(['TSLA']);
  });
});
