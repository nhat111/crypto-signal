import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, hasTestDatabase } from './testPool.js';
import { GEM_ROUND_TRIP_COST_PCT, getGemScoreEdge } from './gems.js';

/**
 * Whether a higher Gem Score actually precedes better outcomes.
 *
 * Against real Postgres because it is a join across two tables plus
 * banding, and because a silently wrong answer here is acted on with money
 * in an illiquid market. A fake pool would only confirm the string was
 * assembled.
 */
describe.skipIf(!hasTestDatabase)('gem score edge against real Postgres', () => {
  let pool: Pool;

  async function scan(score: number, movePct: number | null, liq?: { at: number; after: number }): Promise<void> {
    const { rows } = await pool.query(
      `INSERT INTO gem_scans
         (chain_id, token_address, scanned_at, gem_score, gem_components, risk_score, risk_components, reasons)
       VALUES ('solana', 'tok' || floor(random() * 1e12)::text, now(), $1, '{}'::jsonb, 10, '{}'::jsonb, '[]'::jsonb)
       RETURNING scan_id`,
      [score],
    );
    await pool.query(
      `INSERT INTO gem_outcomes
         (scan_id, price_at_scan, liquidity_at_scan_usd, move_after_24h_pct, move_after_7d_pct, liquidity_after_7d_usd)
       VALUES ($1, 1, $2, $3, $3, $4)`,
      [rows[0].scan_id, liq?.at ?? null, movePct, liq?.after ?? null],
    );
  }

  beforeAll(async () => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM gem_outcomes');
    await pool.query('DELETE FROM gem_scans');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('says nothing at all before there are outcomes', async () => {
    const edge = await getGemScoreEdge(pool, '24h');
    expect(edge.verdict).toBeNull();
    expect(edge.bands.every((b) => b.sampleCount === 0 && !b.sufficientData)).toBe(true);
  });

  it('puts each scan in the band its score falls in, at the boundaries too', async () => {
    await scan(49, 1);
    await scan(50, 1);
    await scan(69, 1);
    await scan(70, 1);
    const { bands } = await getGemScoreEdge(pool, '24h');
    expect(bands.find((b) => b.key === 'low')?.sampleCount).toBe(1);
    expect(bands.find((b) => b.key === 'mid')?.sampleCount).toBe(2);
    expect(bands.find((b) => b.key === 'high')?.sampleCount).toBe(1);
  });

  it('counts a win as clearing the cost of the swap, not as any move up', async () => {
    // The distinction the whole surface exists for: on a pool this thin a
    // +1% move is a losing trade, and counting it as a win is how a
    // scanner with no edge looks like one.
    for (let i = 0; i < 10; i += 1) {
      await scan(80, 1); // up, but under the cost floor
      await scan(80, 10); // up, and worth taking
    }
    const high = (await getGemScoreEdge(pool, '24h')).bands.find((b) => b.key === 'high');
    expect(high?.positiveMovePct).toBe(100);
    expect(high?.netPositiveMovePct).toBe(50);
    expect(GEM_ROUND_TRIP_COST_PCT).toBeGreaterThan(1);
  });

  it('refuses a verdict while either end is thin, however big the gap looks', async () => {
    // Five scans that all went up is not evidence that the score works.
    for (let i = 0; i < 5; i += 1) await scan(80, 50);
    for (let i = 0; i < 5; i += 1) await scan(20, -50);
    expect((await getGemScoreEdge(pool, '24h')).verdict).toBeNull();
  });

  it('calls a real gap real once both ends are thick enough', async () => {
    for (let i = 0; i < 60; i += 1) await scan(80, i < 54 ? 20 : -20); // 90% up
    for (let i = 0; i < 60; i += 1) await scan(20, i < 12 ? 20 : -20); // 20% up
    const { verdict } = await getGemScoreEdge(pool, '24h');
    expect(verdict?.verdict).toBe('beats');
    expect(verdict?.deltaPp).toBeGreaterThan(60);
  });

  it('calls a score that does nothing exactly that, rather than finding a story', async () => {
    // Both bands at the same hit rate. This is the answer that saves money:
    // it means the alerts are firing on a number that predicts nothing.
    for (let i = 0; i < 60; i += 1) await scan(80, i < 30 ? 20 : -20);
    for (let i = 0; i < 60; i += 1) await scan(20, i < 30 ? 20 : -20);
    const { verdict } = await getGemScoreEdge(pool, '24h');
    expect(verdict?.verdict).toBe('indistinguishable');
    expect(verdict?.samplesNeeded).toBeNull(); // no gap to prove
  });

  it('reports the rug rate per band, and only for the horizon that measures it', async () => {
    for (let i = 0; i < 4 ; i += 1) await scan(80, 10, { at: 100_000, after: i === 0 ? 5_000 : 90_000 });
    const at7d = (await getGemScoreEdge(pool, '7d')).bands.find((b) => b.key === 'high');
    const at24h = (await getGemScoreEdge(pool, '24h')).bands.find((b) => b.key === 'high');
    expect(at7d?.liquidityCollapsePct).toBe(25);
    // 24h has no liquidity measurement, so claiming one would be inventing it.
    expect(at24h?.liquidityCollapsePct).toBeNull();
  });
});
