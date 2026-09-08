import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { GEM_TABLES_LOCK, createTestPool, hasTestDatabase, lockTestTables, getLastBaselineAnnouncement } from '@crypto-signal/db';
import { runBaselineAnnounceCycle } from './baselineAnnounce.js';

/**
 * The push, end to end against real Postgres.
 *
 * The unit tests decide when to send. This proves the parts around that
 * decision: that the verdict is read off real outcome rows, that a restart
 * does not re-send (the state is in the database, and this is the whole
 * reason it is), and that a send to nobody is not recorded as delivered.
 */
describe.skipIf(!hasTestDatabase)('baseline announcement cycle', () => {
  let pool: Pool;
  let releaseLock: () => Promise<void>;
  const sent: Array<{ chatId: string; text: string }> = [];

  const notifier = {
    send: async (chatId: string, text: string) => {
      sent.push({ chatId, text });
      return true;
    },
  } as unknown as Parameters<typeof runBaselineAnnounceCycle>[0]['notifier'];

  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

  const deps = (chatIds: string[]) => ({ pool, logger, notifier, telegramAlertChatIds: chatIds });

  /** A scanner call with a recorded 7d outcome. `won` decides whether it cleared the cost floor. */
  async function scannerOutcome(won: boolean, i: number) {
    const { rows } = await pool.query(
      `INSERT INTO gem_tokens (chain_id, token_address, symbol, name, pair_address, dex_id)
       VALUES ('bsc', $1, 'S' || $2, 'S', $1 || '-p', 'pancake')
       ON CONFLICT (chain_id, token_address) DO NOTHING
       RETURNING token_address`,
      [`0xs${i}`, String(i)],
    );
    void rows;
    const scan = await pool.query(
      `INSERT INTO gem_scans (chain_id, token_address, scanned_at, gem_score, gem_components, risk_score, risk_components, reasons, price_usd)
       VALUES ('bsc', $1, now() - interval '8 days', 90, '{}'::jsonb, 20, '{}'::jsonb, '[]'::jsonb, 1)
       RETURNING scan_id`,
      [`0xs${i}`],
    );
    await pool.query(
      `INSERT INTO gem_outcomes (scan_id, price_at_scan, move_after_7d_pct) VALUES ($1, 1, $2)`,
      [scan.rows[0].scan_id, won ? 40 : -30],
    );
  }

  /** A token the scanner rejected, followed to the same horizon. */
  async function controlOutcome(won: boolean, i: number, failure = 'low_liquidity') {
    await pool.query(
      `INSERT INTO gem_baseline_candidates (chain_id, token_address, observed_at, failures, price_usd, move_after_7d_pct)
       VALUES ('bsc', $1, now() - interval '8 days', $2::jsonb, 1, $3)`,
      [`0xc${i}`, JSON.stringify([failure]), won ? 40 : -30],
    );
  }

  async function seed(scannerWins: number, scannerTotal: number, controlWins: number, controlTotal: number) {
    for (let i = 0; i < scannerTotal; i++) await scannerOutcome(i < scannerWins, i);
    for (let i = 0; i < controlTotal; i++) await controlOutcome(i < controlWins, i);
  }

  beforeAll(async () => {
    pool = createTestPool();
    releaseLock = await lockTestTables(pool, GEM_TABLES_LOCK);
  });
  beforeEach(async () => {
    sent.length = 0;
    await pool.query('DELETE FROM gem_baseline_announcements');
    await pool.query('DELETE FROM gem_baseline_candidates');
    await pool.query('DELETE FROM gem_outcomes');
    await pool.query('DELETE FROM gem_scans');
    await pool.query('DELETE FROM gem_tokens');
    await pool.query("DELETE FROM bot_users WHERE chat_id LIKE 'baseline-%'");
  });
  afterAll(async () => {
    await pool.query('DELETE FROM gem_baseline_announcements');
    await pool.query('DELETE FROM gem_baseline_candidates');
    await pool.query('DELETE FROM gem_outcomes');
    await pool.query('DELETE FROM gem_scans');
    await pool.query('DELETE FROM gem_tokens');
    await pool.query("DELETE FROM bot_users WHERE chat_id LIKE 'baseline-%'");
    await releaseLock();
    await pool.end();
  });

  it('says nothing while there are too few outcomes to answer', async () => {
    await seed(3, 5, 2, 4);
    const d = await runBaselineAnnounceCycle(deps(['baseline-chat']));
    expect(d).toEqual({ send: false, why: 'not_ready' });
    expect(sent).toEqual([]);
  });

  it('announces once the outcomes can answer it, and records what it said', async () => {
    await seed(30, 40, 5, 50);
    const d = await runBaselineAnnounceCycle(deps(['baseline-chat']));

    expect(d.send).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toMatch(/SCANNER SO VỚI CHÍNH ĐÁM NÓ LOẠI/);

    const recorded = await getLastBaselineAnnouncement(pool, '7d');
    expect(recorded?.verdict).toBe(d.send ? d.verdict : undefined);
    expect(recorded?.scannerSampleCount).toBe(40);
    expect(recorded?.baselineSampleCount).toBe(50);
  });

  it('does not repeat itself when the worker restarts', async () => {
    // The reason the state is in Postgres. An in-memory flag would
    // re-announce on every Railway deploy, and an alert that repeats is
    // one the reader stops seeing.
    await seed(30, 40, 5, 50);
    await runBaselineAnnounceCycle(deps(['baseline-chat']));
    sent.length = 0;

    const second = await runBaselineAnnounceCycle(deps(['baseline-chat']));
    expect(second).toEqual({ send: false, why: 'unchanged' });
    expect(sent).toEqual([]);
  });

  it('does not mark a verdict announced when there was nobody to tell', async () => {
    // Otherwise the first subscriber to arrive would never hear a verdict
    // that had already "happened" to an empty room.
    await seed(30, 40, 5, 50);
    const d = await runBaselineAnnounceCycle(deps([]));

    expect(d.send).toBe(false);
    expect(sent).toEqual([]);
    expect(await getLastBaselineAnnouncement(pool, '7d')).toBeUndefined();

    const later = await runBaselineAnnounceCycle(deps(['baseline-chat']));
    expect(later.send).toBe(true);
  });

  it('reaches opted-in subscribers as well as the configured chats', async () => {
    // bot_settings.chat_id is an FK to bot_users, so a subscriber only
    // exists once the bot has actually seen that chat.
    await pool.query(`INSERT INTO bot_users (chat_id) VALUES ('baseline-sub') ON CONFLICT (chat_id) DO NOTHING`);
    await pool.query(
      `INSERT INTO bot_settings (chat_id, alerts_enabled) VALUES ('baseline-sub', TRUE)
       ON CONFLICT (chat_id) DO UPDATE SET alerts_enabled = TRUE`,
    );
    await seed(30, 40, 5, 50);
    await runBaselineAnnounceCycle(deps(['baseline-chat']));

    expect(sent.map((s) => s.chatId).sort()).toEqual(['baseline-chat', 'baseline-sub']);
  });

  it('names a control that is really one rejection reason', async () => {
    await seed(30, 40, 0, 0);
    for (let i = 0; i < 45; i++) await controlOutcome(i < 5, i, 'extreme_pump');
    for (let i = 45; i < 50; i++) await controlOutcome(false, i, 'low_liquidity');

    await runBaselineAnnounceCycle(deps(['baseline-chat']));
    expect(sent[0]?.text).toMatch(/90% nhóm đối chứng bị loại vì/);
    expect(sent[0]?.text).toMatch(/extreme_pump/);
  });
});
