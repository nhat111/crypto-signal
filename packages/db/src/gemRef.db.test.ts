import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { GEM_TABLES_LOCK, createTestPool, hasTestDatabase, lockTestTables } from './testPool.js';
import { resolveGemRef } from './gems.js';

/**
 * Naming a token, against real Postgres.
 *
 * This decides which token a watch is attached to, so a wrong answer here
 * silently monitors somebody else's asset while its owner believes theirs
 * is covered. The ambiguity rule and the address match are both SQL; a
 * fake pool would only prove the strings were assembled.
 */
describe.skipIf(!hasTestDatabase)('resolving a gem by ticker or address', () => {
  let pool: Pool;
  let releaseLock: () => Promise<void>;

  async function token(chainId: string, address: string, symbol: string, priceUsd = 1, minutesAgo = 1): Promise<void> {
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
  });
  afterAll(async () => {
    await pool.query('DELETE FROM gem_scans');
    await pool.query('DELETE FROM gem_tokens');
    await releaseLock();
    await pool.end();
  });

  it('finds a token by its ticker when only one carries it', async () => {
    await token('solana', 'addr1', 'BONK');
    const r = await resolveGemRef(pool, 'bonk');
    expect(r.kind).toBe('found');
    expect(r.kind === 'found' && r.gem.symbol).toBe('BONK');
  });

  /**
   * The case that started this: a ticker nobody can type. The address is
   * the only identifier a phone keyboard reliably produces, by paste.
   */
  it('finds a token whose ticker cannot be typed, by address', async () => {
    await token('bsc', '0x8672a5d410c567c1b54703bfeddd7699ffdb1b3f', '富贵');
    const r = await resolveGemRef(pool, '0x8672a5d410c567c1b54703bfeddd7699ffdb1b3f');
    expect(r.kind).toBe('found');
    expect(r.kind === 'found' && r.gem.symbol).toBe('富贵');
  });

  it('still finds it by the unusual ticker if you can produce one', async () => {
    await token('bsc', '0xabc', '富贵');
    expect((await resolveGemRef(pool, '富贵')).kind).toBe('found');
  });

  it('matches an address in whatever casing it was pasted', async () => {
    await token('bsc', '0xAbCdEf0123456789', 'X');
    expect((await resolveGemRef(pool, '0xabcdef0123456789')).kind).toBe('found');
    expect((await resolveGemRef(pool, '0xABCDEF0123456789')).kind).toBe('found');
  });

  /**
   * The dangerous one. Two chains, one ticker: picking the most recently
   * scanned would attach the watch to a token the person does not hold,
   * and nothing would ever say so.
   */
  it('refuses a ticker two tokens share, and names both', async () => {
    await token('solana', 'addrA', 'PONS', 0.5, 60);
    await token('bsc', 'addrB', 'PONS', 40, 1);

    const r = await resolveGemRef(pool, 'PONS');
    expect(r.kind).toBe('ambiguous');
    expect(r.kind === 'ambiguous' && r.matches).toHaveLength(2);
    expect(r.kind === 'ambiguous' && r.matches.map((m) => m.chainId).sort()).toEqual(['bsc', 'solana']);
  });

  it('still resolves the address while its ticker is ambiguous', async () => {
    await token('solana', 'addrA', 'PONS', 0.5);
    await token('bsc', 'addrB', 'PONS', 40);

    const r = await resolveGemRef(pool, 'addrB');
    expect(r.kind === 'found' && r.gem.chainId).toBe('bsc');
  });

  it('takes the newest scan of the token it resolved', async () => {
    await token('solana', 'addr1', 'BONK', 1.0, 90);
    await token('solana', 'addr1', 'BONK', 2.5, 1);

    const r = await resolveGemRef(pool, 'BONK');
    expect(r.kind === 'found' && r.gem.priceUsd).toBe(2.5);
  });

  it('reports nothing found for a token nobody scanned', async () => {
    expect((await resolveGemRef(pool, 'NOSUCH')).kind).toBe('not_found');
    expect((await resolveGemRef(pool, '')).kind).toBe('not_found');
    expect((await resolveGemRef(pool, '   ')).kind).toBe('not_found');
  });

  it('does not let an unscanned namesake make a real token ambiguous', async () => {
    // Only one of these can be watched — the other has no scan and so no
    // entry price. Counting it as a candidate would refuse a request that
    // has exactly one valid answer, and send somebody hunting for an
    // address they do not need.
    await token('solana', 'real', 'TWIN');
    await pool.query(
      `INSERT INTO gem_tokens (chain_id, token_address, symbol, name, pair_address, dex_id)
       VALUES ('bsc', 'neverScanned', 'TWIN', 'Twin', 'twin-pair', 'pancake')`,
    );

    const r = await resolveGemRef(pool, 'TWIN');
    expect(r.kind).toBe('found');
    expect(r.kind === 'found' && r.gem.chainId).toBe('solana');
  });

  it('ignores a token known but never scanned', async () => {
    // gem_tokens without a scan has no price to set as an entry, so it is
    // not something a watch can attach to.
    await pool.query(
      `INSERT INTO gem_tokens (chain_id, token_address, symbol, name, pair_address, dex_id)
       VALUES ('solana', 'lonely', 'LONE', 'Lone', 'lonely-pair', 'raydium')`,
    );
    expect((await resolveGemRef(pool, 'LONE')).kind).toBe('not_found');
  });
});
