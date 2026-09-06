import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { GEM_TABLES_LOCK, createTestPool, hasTestDatabase, lockTestTables } from './testPool.js';
import { getLatestGems } from './gems.js';

/**
 * The /gems list, against real Postgres.
 *
 * The ranking here is DISTINCT ON plus a limit, and those two do not
 * compose the obvious way: DISTINCT ON dictates the ORDER BY, so a limit
 * applied to the same query cuts by chain and address rather than by
 * score. A fake pool cannot see that — it only proves a string was built.
 * The failure mode is silent and it is the whole point of the page: a list
 * that says "highest score first" while missing the highest scores.
 */
describe.skipIf(!hasTestDatabase)('gem list against real Postgres', () => {
  let pool: Pool;
  let releaseLock: () => Promise<void>;

  /** One eligible token, scanned just now. */
  async function scan(chainId: string, tokenAddress: string, gemScore: number): Promise<void> {
    await pool.query(
      `INSERT INTO gem_tokens (chain_id, token_address, symbol, name, pair_address, dex_id)
       VALUES ($1, $2, $2, $2, $2 || '-pair', 'raydium')
       ON CONFLICT (chain_id, token_address) DO NOTHING`,
      [chainId, tokenAddress],
    );
    await pool.query(
      `INSERT INTO gem_scans
         (chain_id, token_address, scanned_at, gem_score, gem_components, risk_score, risk_components, reasons)
       VALUES ($1, $2, now(), $3, '{}'::jsonb, 10, '{}'::jsonb, '[]'::jsonb)`,
      [chainId, tokenAddress, gemScore],
    );
  }

  beforeAll(async () => {
    pool = createTestPool();
    releaseLock = await lockTestTables(pool, GEM_TABLES_LOCK);
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM gem_outcomes');
    await pool.query('DELETE FROM gem_scans');
    await pool.query('DELETE FROM gem_tokens');
  });
  afterAll(async () => {
    await releaseLock();
    await pool.end();
  });

  it('keeps the best-scoring tokens when the limit cuts, not the first chain alphabetically', async () => {
    // The shape that made this worth writing: one chain sorts first and is
    // full of mediocre tokens, the other sorts last and holds the best one.
    // Cutting by (chain, address) throws the best one away.
    for (let i = 0; i < 5; i += 1) await scan('bsc', `0xaaa${i}`, 40 + i);
    await scan('solana', 'SoLbest', 95);

    const top = await getLatestGems(pool, { limit: 3 });

    expect(top).toHaveLength(3);
    expect(top[0].tokenAddress).toBe('SoLbest');
    expect(top.map((g) => g.gemScore)).toEqual([95, 44, 43]);
  });

  it('ranks across chains rather than grouping by chain', async () => {
    await scan('bsc', '0xmid', 60);
    await scan('solana', 'SoLhigh', 80);
    await scan('bsc', '0xlow', 20);
    await scan('robinhood', '0xtop', 90);

    const gems = await getLatestGems(pool, {});

    expect(gems.map((g) => g.chainId)).toEqual(['robinhood', 'solana', 'bsc', 'bsc']);
    expect(gems.map((g) => g.gemScore)).toEqual([90, 80, 60, 20]);
  });

  it('still shows one row per token, the newest scan of it', async () => {
    await scan('solana', 'SoLdup', 30);
    await scan('solana', 'SoLdup', 70);

    const gems = await getLatestGems(pool, {});

    expect(gems).toHaveLength(1);
    expect(gems[0].gemScore).toBe(70);
  });

  it('applies the limit after the score filter, not before it', async () => {
    await scan('bsc', '0xweak', 10);
    await scan('solana', 'SoLstrong', 88);

    const gems = await getLatestGems(pool, { minScore: 50, limit: 1 });

    expect(gems.map((g) => g.tokenAddress)).toEqual(['SoLstrong']);
  });
});
