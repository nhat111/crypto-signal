import type { Pool } from 'pg';

export interface BotSettings {
  chatId: string;
  alertsEnabled: boolean;
  minSeverity: string;
  symbols: string[];
  /** Null until the chat sets its account with /risk. */
  accountUsd: number | null;
  riskPct: number;
}

/** Fields a chat can change. Absent means unchanged; `accountUsd: null` clears the account. */
export interface BotSettingsPatch {
  alertsEnabled?: boolean;
  accountUsd?: number | null;
  riskPct?: number;
}

const SETTINGS_COLUMNS = 'chat_id, alerts_enabled, min_severity, symbols, account_usd, risk_pct';

interface SettingsRow {
  chat_id: string;
  alerts_enabled: boolean;
  min_severity: string;
  symbols: string[];
  account_usd: number | null;
  risk_pct: number;
}

const toSettings = (row: SettingsRow): BotSettings => ({
  chatId: row.chat_id,
  alertsEnabled: row.alerts_enabled,
  minSeverity: row.min_severity,
  symbols: row.symbols,
  accountUsd: row.account_usd,
  riskPct: row.risk_pct,
});

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
  const { rows } = await pool.query<SettingsRow>(`SELECT ${SETTINGS_COLUMNS} FROM bot_settings WHERE chat_id = $1`, [chatId]);
  const row = rows[0];
  return row ? toSettings(row) : undefined;
}

export async function setAlertsEnabled(pool: Pool, chatId: string, enabled: boolean): Promise<void> {
  await updateBotSettings(pool, chatId, { alertsEnabled: enabled });
}

/** Applies the fields present in `patch` and returns the stored row, or undefined for an unknown chat. */
export async function updateBotSettings(pool: Pool, chatId: string, patch: BotSettingsPatch): Promise<BotSettings | undefined> {
  // A flag per field rather than COALESCE, because null is a real value for
  // account_usd ("forget my account") and COALESCE would read it as "keep".
  const { rows } = await pool.query<SettingsRow>(
    `UPDATE bot_settings SET
       alerts_enabled = CASE WHEN $2 THEN $3 ELSE alerts_enabled END,
       account_usd = CASE WHEN $4 THEN $5::double precision ELSE account_usd END,
       risk_pct = CASE WHEN $6 THEN $7::double precision ELSE risk_pct END,
       updated_at = now()
     WHERE chat_id = $1
     RETURNING ${SETTINGS_COLUMNS}`,
    [
      chatId,
      patch.alertsEnabled !== undefined,
      patch.alertsEnabled ?? false,
      patch.accountUsd !== undefined,
      patch.accountUsd ?? null,
      patch.riskPct !== undefined,
      patch.riskPct ?? null,
    ],
  );
  const row = rows[0];
  return row ? toSettings(row) : undefined;
}

export async function getAllAlertSubscribers(pool: Pool): Promise<BotSettings[]> {
  const { rows } = await pool.query<SettingsRow>(`SELECT ${SETTINGS_COLUMNS} FROM bot_settings WHERE alerts_enabled = TRUE`);
  return rows.map(toSettings);
}
