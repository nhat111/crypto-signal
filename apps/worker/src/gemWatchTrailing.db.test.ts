import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { DexScreenerSource } from '@crypto-signal/gem-scanner';
import { GEM_TABLES_LOCK, createTestPool, hasTestDatabase, lockTestTables, insertGemWatch, getActiveWatch } from '@crypto-signal/db';
import { runGemWatchCycle } from './gemWatch.js';

/**
 * The trailing stop through the real worker, against real Postgres.
 *
 * The unit tests prove the rule and the DB tests prove the peak persists.
 * Neither proves the worker joins them correctly, and the join is where
 * this can fail silently: the peak has to be raised BEFORE the evaluation
 * that reads it, or a new high is judged against the previous one and the
 * trailing stop fires a cycle late — or, on a fall, never arms at all.
 *
 * Only the network is faked. Everything else is the code that runs on
 * Railway.
 */
describe.skipIf(!hasTestDatabase)('trailing stop through the worker', () => {
  let pool: Pool;
  let releaseLock: () => Promise<void>;
  const sent: Array<{ chatId: string; text: string }> = [];

  const notifier = {
    send: async (chatId: string, text: string) => {
      sent.push({ chatId, text });
      return true;
    },
  } as unknown as Parameters<typeof runGemWatchCycle>[0]['notifier'];

  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

  /** One price for the watched token, as DexScreener would report it. */
  function priceIs(usd: number) {
    return vi.spyOn(DexScreenerSource.prototype, 'fetchPairsForTokens').mockResolvedValue([
      {
        chainId: 'bsc',
        baseToken: { address: '0xtrail', symbol: 'TRAIL', name: 'Trail' },
        priceUsd: usd,
        liquidityUsd: 10_000,
      },
    ] as never);
  }

  async function armWatch() {
    return insertGemWatch(pool, {
      chatId: 'trail-chat',
      chainId: 'bsc',
      tokenAddress: '0xtrail',
      symbol: 'TRAIL',
      entryPrice: 100,
      entryLiquidityUsd: 10_000,
      entryRiskScore: 20,
      entrySafetyVerdict: 'safe',
      stopLossPct: 25,
      takeProfitPct: 500, // out of the way: this test is about the trailing stop
      liquidityCollapsePct: 50,
      riskScoreAlert: 80,
      trailingStopPct: 20,
      trailingArmPct: 25,
    });
  }

  beforeAll(async () => {
    pool = createTestPool();
    releaseLock = await lockTestTables(pool, GEM_TABLES_LOCK);
  });
  beforeEach(async () => {
    sent.length = 0;
    vi.restoreAllMocks();
    await pool.query('DELETE FROM gem_watches');
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await pool.query('DELETE FROM gem_watches');
    await releaseLock();
    await pool.end();
  });

  it('records a new high without treating it as a sell signal', async () => {
    await armWatch();
    priceIs(140);
    await runGemWatchCycle({ pool, logger, notifier });

    expect(sent).toEqual([]);
    const w = await getActiveWatch(pool, 'trail-chat', 'bsc', '0xtrail');
    expect(w?.peakPrice).toBe(140);
    expect(w?.status).toBe('active');
  });

  it('alerts on the round trip that the fixed triggers sleep through', async () => {
    await armWatch();

    priceIs(140);
    await runGemWatchCycle({ pool, logger, notifier });
    expect(sent).toEqual([]);

    // 112 is 20% below the 140 high, and still +12% on the entry — so
    // neither the stop-loss (75) nor the take-profit could ever see it.
    priceIs(112);
    await runGemWatchCycle({ pool, logger, notifier });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.chatId).toBe('trail-chat');
    expect(sent[0]?.text).toMatch(/trailing stop/i);
    const w = await getActiveWatch(pool, 'trail-chat', 'bsc', '0xtrail');
    expect(w).toBeUndefined(); // closed on trigger, same as every other reason
  });

  it('stays silent while the position holds near its high', async () => {
    await armWatch();
    priceIs(140);
    await runGemWatchCycle({ pool, logger, notifier });
    priceIs(125); // 10.7% off the high, inside the 20% allowed
    await runGemWatchCycle({ pool, logger, notifier });
    expect(sent).toEqual([]);
  });

  it('does not arm on a token that never rose, leaving the stop-loss to report it', async () => {
    await armWatch();
    priceIs(70); // straight dump, peak never left the entry price
    await runGemWatchCycle({ pool, logger, notifier });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toMatch(/stop-loss/i);
    expect(sent[0]?.text).not.toMatch(/trailing/i);
  });
});
