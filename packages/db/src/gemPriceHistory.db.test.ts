import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { GEM_TABLES_LOCK, createTestPool, hasTestDatabase, lockTestTables } from './testPool.js';
import {
  getGemPriceHistory,
  getTrackedGemTokens,
  insertGemPriceObservations,
  pruneGemPriceObservations,
} from './gemPriceHistory.js';

/**
 * The observation log against real Postgres.
 *
 * Everything that matters here is SQL the database enforces: a unique
 * constraint that makes a retried scan idempotent, an EXISTS join that
 * decides which tokens stay on the watchlist, an interval-based prune. A
 * fake pool would confirm the strings were assembled and nothing else —
 * and the cost of getting this wrong is a hole in a series that cannot be
 * backfilled.
 */
describe.skipIf(!hasTestDatabase)('gem price observations against real Postgres', () => {
  let pool: Pool;
  let releaseLock: () => Promise<void>;

  const NOW = Date.now();
  const MINUTE = 60_000;

  const obs = (tokenAddress: string, observedAt: number, priceUsd: number, eligible = true) => ({
    chainId: 'solana',
    tokenAddress,
    observedAt,
    priceUsd,
    liquidityUsd: 100_000,
    volume24hUsd: 50_000,
    eligible,
  });

  /** A token the scanner surfaced at least once — the watchlist's entry condition. */
  async function surfacedToken(address: string, firstSeenDaysAgo = 1, lastSeenDaysAgo = 0): Promise<void> {
    await pool.query(
      `INSERT INTO gem_tokens (chain_id, token_address, symbol, name, pair_address, dex_id, first_seen_at, last_seen_at)
       VALUES ('solana', $1, $1, $1, $1 || '-pair', 'raydium',
               now() - ($2 || ' days')::interval, now() - ($3 || ' days')::interval)`,
      [address, firstSeenDaysAgo, lastSeenDaysAgo],
    );
    await pool.query(
      `INSERT INTO gem_scans
         (chain_id, token_address, scanned_at, gem_score, gem_components, risk_score, risk_components, reasons)
       VALUES ('solana', $1, now(), 60, '{}'::jsonb, 20, '{}'::jsonb, '[]'::jsonb)`,
      [address],
    );
  }

  /** Known to gem_tokens but never scored — belongs to the control group, not the watchlist. */
  async function unsurfacedToken(address: string): Promise<void> {
    await pool.query(
      `INSERT INTO gem_tokens (chain_id, token_address, symbol, name, pair_address, dex_id)
       VALUES ('solana', $1, $1, $1, $1 || '-pair', 'raydium')`,
      [address],
    );
  }

  beforeAll(async () => {
    pool = createTestPool();
    releaseLock = await lockTestTables(pool, GEM_TABLES_LOCK);
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM gem_price_observations');
    await pool.query('DELETE FROM gem_scans');
    await pool.query('DELETE FROM gem_tokens');
  });
  afterAll(async () => {
    await pool.query('DELETE FROM gem_price_observations');
    await pool.query('DELETE FROM gem_scans');
    await pool.query('DELETE FROM gem_tokens');
    await releaseLock();
    await pool.end();
  });

  it('keeps a series across scans, oldest first', async () => {
    await insertGemPriceObservations(pool, [
      obs('a', NOW - 60 * MINUTE, 1.0),
      obs('a', NOW - 30 * MINUTE, 0.4, false),
      obs('a', NOW, 0.9, false),
    ]);

    const history = await getGemPriceHistory(pool, 'solana', 'a');
    expect(history.map((h) => h.priceUsd)).toEqual([1.0, 0.4, 0.9]);
    // The transition out of eligibility is the thing an analysis reads.
    expect(history.map((h) => h.eligible)).toEqual([true, false, false]);
  });

  it('is idempotent, so a retried scan cannot double-record a price', async () => {
    const rows = [obs('a', NOW, 1.0)];
    expect(await insertGemPriceObservations(pool, rows)).toBe(1);
    expect(await insertGemPriceObservations(pool, rows)).toBe(0);
    expect(await getGemPriceHistory(pool, 'solana', 'a')).toHaveLength(1);
  });

  it('writes a whole scan in one statement without losing any row', async () => {
    const inserted = await insertGemPriceObservations(pool, [
      obs('a', NOW, 1),
      obs('b', NOW, 2),
      obs('c', NOW, 3, false),
    ]);
    expect(inserted).toBe(3);
  });

  it('does nothing, cheaply, when there is nothing to write', async () => {
    expect(await insertGemPriceObservations(pool, [])).toBe(0);
  });

  it('reads back nulls as nulls rather than zeros', async () => {
    // A missing liquidity figure is unknown, not "no liquidity" — the
    // distinction the whole codebase turns on.
    await insertGemPriceObservations(pool, [
      { ...obs('a', NOW, 1), liquidityUsd: null, volume24hUsd: null },
    ]);
    const [row] = await getGemPriceHistory(pool, 'solana', 'a');
    expect(row?.liquidityUsd).toBeNull();
    expect(row?.volume24hUsd).toBeNull();
  });

  it('can read just the recent part of a long series', async () => {
    await insertGemPriceObservations(pool, [
      obs('a', NOW - 120 * MINUTE, 1),
      obs('a', NOW - 10 * MINUTE, 2),
    ]);
    const recent = await getGemPriceHistory(pool, 'solana', 'a', NOW - 60 * MINUTE);
    expect(recent.map((h) => h.priceUsd)).toEqual([2]);
  });

  describe('the watchlist', () => {
    it('includes a token that was surfaced at least once', async () => {
      await surfacedToken('a');
      expect(await getTrackedGemTokens(pool, 'solana', { limit: 10, maxAgeDays: 120 })).toEqual(['a']);
    });

    it('excludes a token the scanner never scored', async () => {
      // It has a control row in the baseline instead; re-pricing every
      // token ever seen would blow the API budget on tokens no claim was
      // ever made about.
      await unsurfacedToken('never');
      expect(await getTrackedGemTokens(pool, 'solana', { limit: 10, maxAgeDays: 120 })).toEqual([]);
    });

    it('drops a token older than the age bound', async () => {
      await surfacedToken('old', 200, 0);
      await surfacedToken('new', 5, 0);
      expect(await getTrackedGemTokens(pool, 'solana', { limit: 10, maxAgeDays: 120 })).toEqual(['new']);
    });

    it('respects the budget, keeping the most recently seen', async () => {
      // The bound is a cost ceiling, not a preference: this runs on every
      // scan forever, at one API call per 30 addresses.
      await surfacedToken('stale', 10, 9);
      await surfacedToken('fresh', 10, 0);
      expect(await getTrackedGemTokens(pool, 'solana', { limit: 1, maxAgeDays: 120 })).toEqual(['fresh']);
    });

    it('does not leak tokens from another chain', async () => {
      await surfacedToken('a');
      expect(await getTrackedGemTokens(pool, 'bsc', { limit: 10, maxAgeDays: 120 })).toEqual([]);
    });

    it('names each token once however many times it was scanned', async () => {
      await surfacedToken('a');
      await pool.query(
        `INSERT INTO gem_scans
           (chain_id, token_address, scanned_at, gem_score, gem_components, risk_score, risk_components, reasons)
         VALUES ('solana', 'a', now(), 61, '{}'::jsonb, 20, '{}'::jsonb, '[]'::jsonb)`,
      );
      expect(await getTrackedGemTokens(pool, 'solana', { limit: 10, maxAgeDays: 120 })).toEqual(['a']);
    });
  });

  describe('pruning', () => {
    it('drops observations past the retention window and keeps the rest', async () => {
      const DAY = 24 * 60 * 60 * 1000;
      await insertGemPriceObservations(pool, [
        obs('a', NOW - 400 * DAY, 1),
        obs('a', NOW - 10 * DAY, 2),
      ]);

      expect(await pruneGemPriceObservations(pool, 365)).toBe(1);
      expect((await getGemPriceHistory(pool, 'solana', 'a')).map((h) => h.priceUsd)).toEqual([2]);
    });
  });
});
