import type { Pool } from 'pg';

export interface BotSettings {
  chatId: string;
  alertsEnabled: boolean;
  minSeverity: string;
  symbols: string[];
}

export async function upsertBotUser(pool: Pool, chatId: string, username: string | undefined): Promise<void> {
  await pool.query(
    `INSERT INTO bot_users (chat_id, username) VALUES ($1, $2)
     ON CONFLICT (chat_id) DO UPDATE SET username = EXCLUDED.username, last_seen_at = now()`,
    [chatId, username ?? null],
  );
  await pool.query(
    `INSERT INTO bot_settings (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`,
    [chatId],
  );
}

export async function getBotSettings(pool: Pool, chatId: string): Promise<BotSettings | undefined> {
  const { rows } = await pool.query(
    `SELECT chat_id, alerts_enabled, min_severity, symbols FROM bot_settings WHERE chat_id = $1`,
    [chatId],
  );
  const row = rows[0];
  if (!row) return undefined;
  return { chatId: row.chat_id, alertsEnabled: row.alerts_enabled, minSeverity: row.min_severity, symbols: row.symbols };
}

export async function setAlertsEnabled(pool: Pool, chatId: string, enabled: boolean): Promise<void> {
  await pool.query(`UPDATE bot_settings SET alerts_enabled = $1, updated_at = now() WHERE chat_id = $2`, [enabled, chatId]);
}

export async function getAllAlertSubscribers(pool: Pool): Promise<BotSettings[]> {
  const { rows } = await pool.query(
    `SELECT chat_id, alerts_enabled, min_severity, symbols FROM bot_settings WHERE alerts_enabled = TRUE`,
  );
  return rows.map((row) => ({ chatId: row.chat_id, alertsEnabled: row.alerts_enabled, minSeverity: row.min_severity, symbols: row.symbols }));
}
