import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { GEM_TABLES_LOCK, createTestPool, hasTestDatabase, lockTestTables } from '@crypto-signal/db';
import type { GemPair, ScoredGem } from '@crypto-signal/gem-scanner';
import { persistAndMaybeAlert, type GemScanDeps } from './gemScan.js';

/**
 * Which scans get an outcome row.
 *
 * This is the pipeline the entire gem performance surface reads from, and
 * it was silently starving it: outcomes were written only for scans above
 * the alert threshold, so every recorded row scored 70+ and the score-band
 * table had nothing to compare a high score against. Fifty-five rows went
 * into production, all in one band, before anyone could see it — because
 * nothing tested what the writer wrote.
 */
describe.skipIf(!hasTestDatabase)('gem outcome coverage against real Postgres', () => {
  let pool: Pool;

  function pair(overrides: Partial<GemPair> = {}): GemPair {
    return {
      chainId: 'solana',
      dexId: 'raydium',
      pairAddress: `pair-${Math.random().toString(36).slice(2)}`,
      baseToken: { address: `tok-${Math.random().toString(36).slice(2)}`, name: 'Test', symbol: 'TEST' },
      quoteToken: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL' },
      priceUsd: 1,
      liquidityUsd: 100_000,
      fdvUsd: 1_000_000,
      marketCapUsd: 1_000_000,
      volume: { h1: 5_000, h6: 20_000, h24: 50_000 },
      priceChangePct: { m5: 0, h1: 0, h6: 0, h24: 0 },
      txns: { h1: { buys: 5, sells: 5 }, h24: { buys: 10, sells: 10 } },
      pairCreatedAt: Date.now() - 30 * 86_400_000,
      url: null,
      ...overrides,
    } as GemPair;
  }

  function gem(score: number): ScoredGem {
    return {
      pair: pair(),
      evaluation: { eligible: true, failures: [], score, components: null, riskScore: 20, riskComponents: null, reasons: [] },
      safety: null,
    } as unknown as ScoredGem;
  }

  function deps(): GemScanDeps {
    return {
      pool,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      gemConfig: { alert: { minScore: 70, cooldownHours: 6 } },
      notifier: { enabled: false, send: vi.fn() },
      telegramAlertChatIds: [],
    } as unknown as GemScanDeps;
  }

  async function outcomeCount(): Promise<number> {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM gem_outcomes');
    return rows[0].n as number;
  }

  let releaseLock: () => Promise<void>;

  beforeAll(async () => {
    pool = createTestPool();
    // These tables are cleared between cases, and another suite in a
    // different workspace clears them too.
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

  it('records an outcome for a scan too low to alert on', async () => {
    // The control group. Without these rows there is no low band, and with
    // no low band the score can never be shown to predict anything.
    await persistAndMaybeAlert(deps(), gem(40), Date.now());
    expect(await outcomeCount()).toBe(1);
  });

  it('records an outcome for an alert-worthy scan too', async () => {
    await persistAndMaybeAlert(deps(), gem(85), Date.now());
    expect(await outcomeCount()).toBe(1);
  });

  it('keeps the score on the scan, so outcomes can be banded later', async () => {
    await persistAndMaybeAlert(deps(), gem(42), Date.now());
    const { rows } = await pool.query(
      'SELECT s.gem_score FROM gem_outcomes o JOIN gem_scans s ON s.scan_id = o.scan_id',
    );
    expect(rows[0].gem_score).toBe(42);
  });

  it('writes nothing to track when there is no price to track from', async () => {
    // An outcome measured from a null entry price would be a fabricated
    // number, which is worse than a missing one.
    const priceless = { ...gem(85), pair: pair({ priceUsd: null }) } as ScoredGem;
    await persistAndMaybeAlert(deps(), priceless, Date.now());
    expect(await outcomeCount()).toBe(0);
  });
});
