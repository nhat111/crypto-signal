import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, hasTestDatabase } from './testPool.js';
import { getAllAlertSubscribers, getBotSettings, setAlertsEnabled, updateBotSettings, upsertBotUser } from './botUsers.js';

const CHAT = 'test-risk-profile';

describe.skipIf(!hasTestDatabase)('bot settings risk profile against real Postgres', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
    await pool.query('DELETE FROM bot_users WHERE chat_id = $1', [CHAT]);
    await upsertBotUser(pool, CHAT, undefined);
  });
  afterAll(async () => {
    await pool.query('DELETE FROM bot_users WHERE chat_id = $1', [CHAT]);
    await pool.end();
  });

  it('starts with no account and the default 1% risk', async () => {
    const settings = await getBotSettings(pool, CHAT);
    expect(settings?.accountUsd).toBeNull();
    expect(settings?.riskPct).toBe(1);
  });

  it('updates only the fields given', async () => {
    const after = await updateBotSettings(pool, CHAT, { accountUsd: 2500, riskPct: 0.5 });
    expect(after).toMatchObject({ accountUsd: 2500, riskPct: 0.5, alertsEnabled: true });
    await setAlertsEnabled(pool, CHAT, false);
    expect(await getBotSettings(pool, CHAT)).toMatchObject({ accountUsd: 2500, riskPct: 0.5, alertsEnabled: false });
    await updateBotSettings(pool, CHAT, { riskPct: 2 });
    expect(await getBotSettings(pool, CHAT)).toMatchObject({ accountUsd: 2500, riskPct: 2 });
  });

  it('clears the account on an explicit null, which COALESCE would have read as "keep"', async () => {
    await updateBotSettings(pool, CHAT, { accountUsd: null });
    expect((await getBotSettings(pool, CHAT))?.accountUsd).toBeNull();
  });

  it('returns undefined for an unknown chat', async () => {
    expect(await updateBotSettings(pool, 'no-such-chat', { riskPct: 1 })).toBeUndefined();
  });

  it('rejects a risk above 5% at the database too', async () => {
    await expect(updateBotSettings(pool, CHAT, { riskPct: 6 })).rejects.toThrow();
  });

  it('carries the profile on the subscriber list the alert reads', async () => {
    await updateBotSettings(pool, CHAT, { alertsEnabled: true, accountUsd: 800, riskPct: 1 });
    const row = (await getAllAlertSubscribers(pool)).find((s) => s.chatId === CHAT);
    expect(row).toMatchObject({ accountUsd: 800, riskPct: 1 });
  });
});
