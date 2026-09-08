import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { GEM_TABLES_LOCK, createTestPool, hasTestDatabase, lockTestTables } from './testPool.js';
import { getActiveWatch, insertGemWatch, raiseGemWatchPeak } from './gemWatches.js';

/**
 * The high-water mark behind the trailing stop, against real Postgres.
 *
 * The rule that matters — a peak only ever rises — lives in the UPDATE's
 * WHERE clause, so a fake pool would prove nothing about it. A peak that
 * can fall silently disarms the trigger that depends on it.
 */

const base = {
  chatId: 'peak-test',
  chainId: 'bsc',
  tokenAddress: '0xpeak',
  symbol: 'PEAK',
  entryPrice: 100,
  entryLiquidityUsd: 10_000,
  entryRiskScore: 20,
  entrySafetyVerdict: 'safe',
  stopLossPct: 25,
  takeProfitPct: 50,
  liquidityCollapsePct: 50,
  riskScoreAlert: 80,
  trailingStopPct: 20,
  trailingArmPct: 25,
};

describe.skipIf(!hasTestDatabase)('gem watch peak tracking', () => {
  let pool: Pool;
  let releaseLock: () => Promise<void>;

  beforeAll(async () => {
    pool = createTestPool();
    releaseLock = await lockTestTables(pool, GEM_TABLES_LOCK);
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM gem_watches');
  });
  afterAll(async () => {
    await pool.query('DELETE FROM gem_watches');
    await releaseLock();
    await pool.end();
  });

  // Inside the block: `pool` is only assigned in beforeAll, so a helper
  // hoisted above the describe would close over an undefined binding.
  async function arm() {
    return insertGemWatch(pool, base);
  }

  async function readBack() {
    const w = await getActiveWatch(pool, base.chatId, base.chainId, base.tokenAddress);
    if (!w) throw new Error('watch vanished');
    return w;
  }

  it('seeds the peak at the entry price, not at null', async () => {
    // Before a position has ever been up, the best it has done IS the
    // entry. A null here would push that rule onto every reader.
    const w = await arm();
    expect(w.peakPrice).toBe(100);
    expect(w.peakAt).not.toBeNull();
  });

  it('stores the trailing thresholds on the row, not read live from env', async () => {
    const w = await arm();
    expect(w.trailingStopPct).toBe(20);
    expect(w.trailingArmPct).toBe(25);
  });

  it('raises the peak on a new high and returns it', async () => {
    const w = await arm();
    expect(await raiseGemWatchPeak(pool, w.id, 140)).toBe(140);
    expect((await readBack()).peakPrice).toBe(140);
  });

  it('refuses to lower the peak — a peak that can fall disarms the trailing stop', async () => {
    const w = await arm();
    await raiseGemWatchPeak(pool, w.id, 140);
    expect(await raiseGemWatchPeak(pool, w.id, 90)).toBe(140);
    expect((await readBack()).peakPrice).toBe(140);
  });

  it('returns the standing peak, not the price it was offered', async () => {
    // The whole reason it returns a value: a caller that inferred "no
    // change means my copy is still current" would evaluate the trailing
    // stop against a peak another pass has already moved past.
    const w = await arm();
    await raiseGemWatchPeak(pool, w.id, 180);
    expect(await raiseGemWatchPeak(pool, w.id, 120)).toBe(180);
  });

  it('returns null for a watch that no longer exists', async () => {
    const w = await arm();
    await pool.query('DELETE FROM gem_watches WHERE id = $1', [w.id]);
    expect(await raiseGemWatchPeak(pool, w.id, 140)).toBeNull();
  });

  it('survives an out-of-order write, which is why the guard is in SQL', async () => {
    // The worker reads every active watch, then writes them one at a time.
    // A second pass can land between those moments; a caller comparing
    // against its own stale copy would push the peak back down.
    const w = await arm();
    await Promise.all([
      raiseGemWatchPeak(pool, w.id, 180),
      raiseGemWatchPeak(pool, w.id, 120),
      raiseGemWatchPeak(pool, w.id, 150),
    ]);
    expect((await readBack()).peakPrice).toBe(180);
  });

  it('moves peak_at only when the peak actually moves', async () => {
    const w = await arm();
    await raiseGemWatchPeak(pool, w.id, 140);
    const after = await readBack();
    await raiseGemWatchPeak(pool, w.id, 100);
    expect((await readBack()).peakAt).toBe(after.peakAt);
  });
});
