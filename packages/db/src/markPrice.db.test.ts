import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { GEM_TABLES_LOCK, createTestPool, hasTestDatabase, lockTestTables } from './testPool.js';
import { getMarkPrices } from './markPrice.js';

/**
 * Mark prices against real Postgres.
 *
 * This reads two unrelated tables and picks a winner per symbol, with a
 * DISTINCT ON in each. A fake pool would confirm the strings were built
 * and nothing else — and the number it produces is one somebody decides
 * whether to sell on.
 */
describe.skipIf(!hasTestDatabase)('mark prices against real Postgres', () => {
  let pool: Pool;
  let releaseLock: () => Promise<void>;

  async function snapshot(symbol: string, priceClose: number, minutesAgo = 1): Promise<void> {
    await pool.query(
      `INSERT INTO market_health_snapshots
         (symbol, timeframe, timestamp, price_close, price_change_pct, risk_score, risk_components, data_quality_score)
       VALUES ($1, '15m', now() - ($2 || ' minutes')::interval, $3, 0, 10, '{}'::jsonb, 100)`,
      [symbol, minutesAgo, priceClose],
    );
  }

  async function gemScan(chainId: string, address: string, symbol: string, priceUsd: number | null, minutesAgo = 5): Promise<void> {
    await pool.query(
      `INSERT INTO gem_tokens (chain_id, token_address, symbol, name, pair_address, dex_id)
       VALUES ($1, $2, $3, $3, $2 || '-pair', 'raydium')
       ON CONFLICT (chain_id, token_address) DO NOTHING`,
      [chainId, address, symbol],
    );
    await pool.query(
      `INSERT INTO gem_scans
         (chain_id, token_address, scanned_at, gem_score, gem_components, risk_score, risk_components, reasons, price_usd)
       VALUES ($1, $2, now() - ($3 || ' minutes')::interval, 60, '{}'::jsonb, 20, '{}'::jsonb, '[]'::jsonb, $4)`,
      [chainId, address, minutesAgo, priceUsd],
    );
  }

  beforeAll(async () => {
    pool = createTestPool();
    releaseLock = await lockTestTables(pool, GEM_TABLES_LOCK);
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM gem_scans');
    await pool.query('DELETE FROM gem_tokens');
    await pool.query("DELETE FROM market_health_snapshots WHERE symbol LIKE 'TEST%'");
  });
  afterAll(async () => {
    await pool.query('DELETE FROM gem_scans');
    await pool.query('DELETE FROM gem_tokens');
    await pool.query("DELETE FROM market_health_snapshots WHERE symbol LIKE 'TEST%'");
    await releaseLock();
    await pool.end();
  });

  it('returns nothing at all for an empty request', async () => {
    expect((await getMarkPrices(pool, [])).size).toBe(0);
    expect((await getMarkPrices(pool, ['   '])).size).toBe(0);
  });

  it('takes the newest snapshot for an exchange ticker', async () => {
    await snapshot('TESTBTC', 70_000, 30);
    await snapshot('TESTBTC', 78_000, 1);

    const mark = (await getMarkPrices(pool, ['TESTBTC'])).get('TESTBTC');
    expect(mark?.priceUsd).toBe(78_000);
    expect(mark?.source).toBe('snapshot');
    expect(mark?.unknownReason).toBeNull();
  });

  it('takes the newest scan for a gem, by ticker', async () => {
    await gemScan('solana', 'addr1', 'PONS', 1.0, 60);
    await gemScan('solana', 'addr1', 'PONS', 1.5, 5);

    const mark = (await getMarkPrices(pool, ['PONS'])).get('PONS');
    expect(mark?.priceUsd).toBe(1.5);
    expect(mark?.source).toBe('gem_scan');
  });

  it('matches a Solana address exactly as the journal stored it', async () => {
    const address = 'bdm98av7y3geqrhnn3f8uvcdlxngm7xbxxqzcgpbrub';
    await gemScan('solana', address, 'NOVALUE', 0.00042);

    expect((await getMarkPrices(pool, [address])).get(address)?.priceUsd).toBe(0.00042);
  });

  it('refuses to price a ticker two different tokens share', async () => {
    // The reason this is not just "pick the newest": both are real, and
    // the wrong one is a confident number somebody sells on.
    await gemScan('solana', 'addrA', 'PONS', 0.5);
    await gemScan('bsc', 'addrB', 'PONS', 40);

    const mark = (await getMarkPrices(pool, ['PONS'])).get('PONS');
    expect(mark?.priceUsd).toBeNull();
    expect(mark?.unknownReason).toBe('ambiguous_ticker');
  });

  it('still prices the address even while its ticker is ambiguous', async () => {
    await gemScan('solana', 'addrA', 'PONS', 0.5);
    await gemScan('bsc', 'addrB', 'PONS', 40);

    expect((await getMarkPrices(pool, ['addrB'])).get('addrB')?.priceUsd).toBe(40);
  });

  it('prefers a snapshot over a gem scan for the same string', async () => {
    // An exchange ticker that also exists as a gem ticker: the exchange is
    // the venue the position was actually taken on.
    await snapshot('TESTSOL', 200);
    await gemScan('solana', 'addrC', 'TESTSOL', 0.01);

    const mark = (await getMarkPrices(pool, ['TESTSOL'])).get('TESTSOL');
    expect(mark?.source).toBe('snapshot');
    expect(mark?.priceUsd).toBe(200);
  });

  it('skips a scan that recorded no price rather than treating it as zero', async () => {
    await gemScan('solana', 'addrD', 'NOPRICE', null);

    const mark = (await getMarkPrices(pool, ['NOPRICE'])).get('NOPRICE');
    expect(mark?.priceUsd).toBeNull();
    expect(mark?.unknownReason).toBe('not_found');
  });

  it('says not_found for a symbol neither source knows', async () => {
    const mark = (await getMarkPrices(pool, ['WHOKNOWS'])).get('WHOKNOWS');
    expect(mark?.unknownReason).toBe('not_found');
  });

  it('answers every symbol asked for, in one call', async () => {
    await snapshot('TESTBTC', 78_000);
    await gemScan('solana', 'addrE', 'PONS', 1.5);

    const marks = await getMarkPrices(pool, ['TESTBTC', 'PONS', 'WHOKNOWS', 'TESTBTC']);
    expect([...marks.keys()].sort()).toEqual(['PONS', 'TESTBTC', 'WHOKNOWS']);
  });
});
