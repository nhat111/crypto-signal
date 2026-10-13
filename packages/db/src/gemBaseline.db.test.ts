import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { GEM_TABLES_LOCK, createTestPool, hasTestDatabase, lockTestTables } from './testPool.js';
import {
  GEM_ROUND_TRIP_COST_PCT,
  getBaselinePendingOutcome,
  getGemBaseline,
  getGemPerformance,
  getGemsPendingOutcome,
  insertGemBaselineCandidates,
  recordGemBaselineOutcome,
  recordGemOutcome,
} from './gems.js';

/**
 * The control group, against real Postgres.
 *
 * This is the number that decides whether the scanner is worth using at
 * all, so a wrong answer here is acted on with money. It is also a pile of
 * SQL — partial indexes, a per-horizon column pair, a join-free aggregate
 * — that a fake pool would only confirm the string was assembled.
 */
describe.skipIf(!hasTestDatabase)('gem market baseline against real Postgres', () => {
  let pool: Pool;
  let releaseLock: () => Promise<void>;
  let seq = 0;

  /** One control-group member, optionally already priced. */
  async function candidate(opts: {
    movePct?: number | null;
    failures?: string[];
    observedMsAgo?: number;
    horizon?: '24h' | '7d';
  } = {}): Promise<string> {
    seq += 1;
    const token = `base${seq}`;
    const observedAt = Date.now() - (opts.observedMsAgo ?? 0);
    await insertGemBaselineCandidates(pool, [
      {
        chainId: 'solana',
        tokenAddress: token,
        observedAt,
        priceUsd: 1,
        liquidityUsd: 100_000,
        failures: opts.failures ?? ['too_young'],
      },
    ]);
    if (opts.movePct !== undefined && opts.movePct !== null) {
      const { rows } = await pool.query(
        'SELECT candidate_id FROM gem_baseline_candidates WHERE token_address = $1',
        [token],
      );
      await recordGemBaselineOutcome(
        pool,
        rows[0].candidate_id,
        opts.horizon ?? '24h',
        { price: 1 + opts.movePct / 100, movePct: opts.movePct, basis: 'observed' },
        50_000,
      );
    }
    return token;
  }

  /** One of the scanner's own picks, so the comparison has both sides. */
  async function pick(score: number, movePct: number): Promise<void> {
    seq += 1;
    const { rows } = await pool.query(
      `INSERT INTO gem_scans
         (chain_id, token_address, scanned_at, gem_score, gem_components, risk_score, risk_components, reasons)
       VALUES ('solana', $1, now(), $2, '{}'::jsonb, 10, '{}'::jsonb, '[]'::jsonb)
       RETURNING scan_id`,
      [`pick${seq}`, score],
    );
    await pool.query(
      `INSERT INTO gem_outcomes (scan_id, price_at_scan, move_after_24h_pct)
       VALUES ($1, 1, $2)`,
      [rows[0].scan_id, movePct],
    );
  }

  beforeAll(async () => {
    pool = createTestPool();
    releaseLock = await lockTestTables(pool, GEM_TABLES_LOCK);
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM gem_baseline_candidates');
    await pool.query('DELETE FROM gem_outcomes');
    await pool.query('DELETE FROM gem_scans');
  });
  afterAll(async () => {
    await releaseLock();
    await pool.end();
  });

  it('reports nothing rather than zero before any control is priced', async () => {
    // "No baseline recorded" and "the baseline was 0%" are different facts,
    // and only one of them is true on a fresh deploy.
    const baseline = await getGemBaseline(pool, '24h');
    expect(baseline.sampleCount).toBe(0);
    expect(baseline.netPositiveMovePct).toBeNull();
    expect(baseline.medianMovePct).toBeNull();
    expect(baseline.sufficientData).toBe(false);
  });

  it('omits the comparison from performance entirely when there is no control', async () => {
    await pick(80, 10);
    const performance = await getGemPerformance(pool, '24h');
    expect(performance.baseline).toBeUndefined();
  });

  it('measures the control on the same cost floor as the scanner', async () => {
    // A move that does not clear the round-trip cost is not a win on
    // either side. Comparing a gross rate against a net one would
    // manufacture an edge out of arithmetic.
    await candidate({ movePct: GEM_ROUND_TRIP_COST_PCT + 1 });
    await candidate({ movePct: GEM_ROUND_TRIP_COST_PCT - 1 });
    const baseline = await getGemBaseline(pool, '24h');
    expect(baseline.sampleCount).toBe(2);
    expect(baseline.positiveMovePct).toBe(100);
    expect(baseline.netPositiveMovePct).toBe(50);
  });

  it('keeps the two horizons apart', async () => {
    await candidate({ movePct: 50, horizon: '7d' });
    expect((await getGemBaseline(pool, '24h')).sampleCount).toBe(0);
    expect((await getGemBaseline(pool, '7d')).sampleCount).toBe(1);
  });

  it('counts the reasons so a lopsided control is visible', async () => {
    // A "market baseline" made entirely of tokens that had already pumped
    // 300% is not a market baseline, and nothing else on the page would
    // reveal that.
    await candidate({ movePct: 1, failures: ['extreme_pump'] });
    await candidate({ movePct: 1, failures: ['extreme_pump'] });
    await candidate({ movePct: 1, failures: ['too_young', 'fdv_too_high'] });
    const { failureCounts } = await getGemBaseline(pool, '24h');
    expect(failureCounts.extreme_pump).toBe(2);
    expect(failureCounts.too_young).toBe(1);
    expect(failureCounts.fdv_too_high).toBe(1);
  });

  it('offers a candidate for pricing only once its horizon has passed', async () => {
    await candidate({ observedMsAgo: 0 });
    await candidate({ observedMsAgo: 25 * 60 * 60_000 });
    const pending = await getBaselinePendingOutcome(pool, '24h', Date.now());
    expect(pending).toHaveLength(1);
  });

  it('stops offering a candidate once it is priced', async () => {
    const token = await candidate({ observedMsAgo: 25 * 60 * 60_000 });
    expect(await getBaselinePendingOutcome(pool, '24h', Date.now())).toHaveLength(1);

    const { rows } = await pool.query(
      'SELECT candidate_id FROM gem_baseline_candidates WHERE token_address = $1',
      [token],
    );
    await recordGemBaselineOutcome(pool, rows[0].candidate_id, '24h', { price: 2, movePct: 100, basis: 'observed' }, 1000);

    expect(await getBaselinePendingOutcome(pool, '24h', Date.now())).toHaveLength(0);
    // Still pending at the longer horizon — the two are tracked separately.
    expect(await getBaselinePendingOutcome(pool, '7d', Date.now() + 8 * 24 * 60 * 60_000)).toHaveLength(1);
  });

  it('hands the tracker what it needs to tell a late quote from a dead pool', async () => {
    const observedMsAgo = 25 * 60 * 60_000;
    await candidate({ observedMsAgo });
    const [row] = await getBaselinePendingOutcome(pool, '24h', Date.now());
    expect(row?.liquidityAtObservationUsd).toBe(100_000);
    // Due one horizon after it was observed, to within the test's own runtime.
    expect(Math.abs((row?.dueAt ?? 0) - (Date.now() - observedMsAgo + 24 * 60 * 60_000))).toBeLessThan(5_000);
  });

  it('records a written-off pool as a loss, says so, and stops offering it', async () => {
    const token = await candidate({ observedMsAgo: 3 * 24 * 60 * 60_000 });
    const { rows } = await pool.query(
      'SELECT candidate_id FROM gem_baseline_candidates WHERE token_address = $1',
      [token],
    );
    await recordGemBaselineOutcome(pool, rows[0].candidate_id, '24h', { price: 0, movePct: -100, basis: 'pool_gone' }, null);

    expect(await getBaselinePendingOutcome(pool, '24h', Date.now())).toHaveLength(0);
    const { rows: stored } = await pool.query(
      'SELECT move_after_24h_pct, outcome_basis_24h FROM gem_baseline_candidates WHERE token_address = $1',
      [token],
    );
    expect(Number(stored[0].move_after_24h_pct)).toBe(-100);
    expect(stored[0].outcome_basis_24h).toBe('pool_gone');
    expect((await getGemBaseline(pool, '24h')).netPositiveMovePct).toBe(0);
  });

  it('records the scanner side the same way, liquidity included at 7d', async () => {
    const { rows } = await pool.query(
      `INSERT INTO gem_scans
         (chain_id, token_address, scanned_at, gem_score, gem_components, risk_score, risk_components, reasons)
       VALUES ('solana', 'drained', now() - interval '8 days', 80, '{}'::jsonb, 10, '{}'::jsonb, '[]'::jsonb)
       RETURNING scan_id`,
    );
    const scanId = rows[0].scan_id as string;
    await pool.query(
      `INSERT INTO gem_outcomes (scan_id, price_at_scan, liquidity_at_scan_usd) VALUES ($1, 1, 100000)`,
      [scanId],
    );

    const [pending] = await getGemsPendingOutcome(pool, '7d', Date.now());
    expect(pending?.liquidityAtScanUsd).toBe(100_000);

    await recordGemOutcome(pool, scanId, '7d', { price: 3, movePct: -100, basis: 'liquidity_collapsed' }, 1, 900);
    const { rows: stored } = await pool.query(
      `SELECT price_after_7d, move_after_7d_pct, outcome_basis_7d, liquidity_after_7d_usd
       FROM gem_outcomes WHERE scan_id = $1`,
      [scanId],
    );
    expect(Number(stored[0].price_after_7d)).toBe(3);
    expect(Number(stored[0].move_after_7d_pct)).toBe(-100);
    expect(stored[0].outcome_basis_7d).toBe('liquidity_collapsed');
    expect(Number(stored[0].liquidity_after_7d_usd)).toBe(900);
    expect(await getGemsPendingOutcome(pool, '7d', Date.now())).toHaveLength(0);
  });

  it('does not count the same token twice from a retried scan', async () => {
    const observedAt = Date.now();
    const row = {
      chainId: 'solana',
      tokenAddress: 'dupe',
      observedAt,
      priceUsd: 1,
      liquidityUsd: 1000,
      failures: ['too_young'],
    };
    expect(await insertGemBaselineCandidates(pool, [row])).toBe(1);
    expect(await insertGemBaselineCandidates(pool, [row])).toBe(0);
  });

  it('calls the scanner worse when it loses to the control by more than the noise', async () => {
    // The finding this whole feature exists to be able to report. Every
    // pick loses money, every control makes it, on samples large enough
    // that the gap clears the margin.
    for (let i = 0; i < 40; i += 1) await pick(80, -30);
    for (let i = 0; i < 40; i += 1) await candidate({ movePct: 30 });

    const performance = await getGemPerformance(pool, '24h', 70);
    expect(performance.baseline?.verdict).toBe('worse');
    expect(performance.baseline?.deltaPp).toBeLessThan(0);
    expect(performance.baseline?.medianDeltaPp).toBeLessThan(0);
  });

  it('refuses to call a thin lead real', async () => {
    // Three picks that happened to go the right way is not a finding, and
    // this is the shape the control will be in for its first day of life.
    // (A *perfect* split of six versus six genuinely is significant — the
    // guard that matters is against a handful, not against arithmetic.)
    for (let i = 0; i < 3; i += 1) await pick(80, 40);
    for (let i = 0; i < 20; i += 1) await candidate({ movePct: i % 2 === 0 ? 40 : -40 });

    const performance = await getGemPerformance(pool, '24h', 70);
    expect(performance.baseline?.verdict).toBe('indistinguishable');
  });

  it('does not let the page show a verdict before the control is deep enough', async () => {
    // Two guards, deliberately. The statistics above decide whether a gap
    // is real; this one decides whether there is enough of a control to be
    // asking. The panel reads sufficientData and stays quiet below it.
    for (let i = 0; i < 40; i += 1) await pick(80, -30);
    for (let i = 0; i < 5; i += 1) await candidate({ movePct: 30 });

    const performance = await getGemPerformance(pool, '24h', 70);
    expect(performance.baseline?.sampleCount).toBe(5);
    expect(performance.baseline?.sufficientData).toBe(false);
  });

  it('compares the alerted picks, not every eligible scan', async () => {
    // The headline has always meant "when the scanner actually called
    // something". Letting the low scorers into the comparison would change
    // that meaning with nothing on the page saying so.
    for (let i = 0; i < 30; i += 1) await pick(80, 40);
    for (let i = 0; i < 30; i += 1) await pick(10, -90);
    for (let i = 0; i < 30; i += 1) await candidate({ movePct: -40 });

    const alerted = await getGemPerformance(pool, '24h', 70);
    const everything = await getGemPerformance(pool, '24h');
    expect(alerted.baseline?.deltaPp).toBeGreaterThan(everything.baseline?.deltaPp ?? 0);
  });
});
