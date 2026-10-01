import type { Pool } from 'pg';

export type TrendLabel = 'up' | 'down' | 'sideways';
export type TrendEvent = 'up_broken' | 'down_broken' | null;

export interface TrendSwingPoint {
  openTime: number;
  price: number;
}

export interface TrendStateRow {
  symbol: string;
  lastCloseTime: number;
  lastClose: number;
  trend: TrendLabel;
  event: TrendEvent;
  previousTrend: TrendLabel | null;
  changedAt: number | null;
  ema: number | null;
  emaPeriod: number;
  aboveEma: boolean | null;
  swingHighs: TrendSwingPoint[];
  swingLows: TrendSwingPoint[];
  reasons: string[];
  computedAt: number;
}

export interface TrendStateInput {
  symbol: string;
  lastCloseTime: number;
  lastClose: number;
  trend: TrendLabel;
  event: TrendEvent;
  ema: number | null;
  emaPeriod: number;
  aboveEma: boolean | null;
  swingHighs: TrendSwingPoint[];
  swingLows: TrendSwingPoint[];
  reasons: string[];
}

function toRow(r: Record<string, unknown>): TrendStateRow {
  return {
    symbol: r['symbol'] as string,
    lastCloseTime: Number(r['last_close_ms']),
    lastClose: Number(r['last_close']),
    trend: r['trend'] as TrendLabel,
    event: (r['event'] as TrendEvent) ?? null,
    previousTrend: (r['previous_trend'] as TrendLabel | null) ?? null,
    changedAt: r['changed_at_ms'] === null ? null : Number(r['changed_at_ms']),
    ema: r['ema'] === null ? null : Number(r['ema']),
    emaPeriod: Number(r['ema_period']),
    aboveEma: (r['above_ema'] as boolean | null) ?? null,
    swingHighs: r['swing_highs'] as TrendSwingPoint[],
    swingLows: r['swing_lows'] as TrendSwingPoint[],
    reasons: r['reasons'] as string[],
    computedAt: Number(r['computed_at_ms']),
  };
}

const COLUMNS = `symbol, last_close, trend, event, previous_trend, ema, ema_period, above_ema, swing_highs, swing_lows, reasons,
  extract(epoch from last_close_time)*1000 AS last_close_ms,
  extract(epoch from changed_at)*1000 AS changed_at_ms,
  extract(epoch from computed_at)*1000 AS computed_at_ms`;

export async function getTrendStates(pool: Pool): Promise<TrendStateRow[]> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM trend_states ORDER BY symbol`);
  return rows.map(toRow);
}

export interface TrendUpsertResult {
  row: TrendStateRow;
  /** True when this read used a daily bar the stored one had not seen. */
  newClose: boolean;
  /** True when the label differs from what was stored before this read. */
  labelChanged: boolean;
  /** True when the break event is new on this close (not carried over from yesterday). */
  newEvent: boolean;
}

/**
 * Writes one symbol's read, remembering the label it replaces.
 *
 * `previous_trend` and `changed_at` only move when the label actually
 * changes on a NEW close — re-reading the same bar every hour must not make
 * yesterday's change look like it happened again.
 */
export async function upsertTrendState(pool: Pool, input: TrendStateInput): Promise<TrendUpsertResult> {
  const { rows: prevRows } = await pool.query(
    `SELECT trend, event, extract(epoch from last_close_time)*1000 AS last_close_ms FROM trend_states WHERE symbol = $1`,
    [input.symbol],
  );
  const prev = prevRows[0] as { trend: TrendLabel; event: TrendEvent; last_close_ms: string } | undefined;
  const newClose = !prev || Number(prev.last_close_ms) < input.lastCloseTime;
  const labelChanged = !!prev && newClose && prev.trend !== input.trend;
  const newEvent = input.event !== null && newClose && (!prev || prev.event !== input.event);

  const { rows } = await pool.query(
    `INSERT INTO trend_states (symbol, last_close_time, last_close, trend, event, previous_trend, changed_at,
                               ema, ema_period, above_ema, swing_highs, swing_lows, reasons, computed_at)
     VALUES ($1, to_timestamp($2/1000.0), $3, $4, $5, NULL, NULL, $6, $7, $8, $9, $10, $11, now())
     ON CONFLICT (symbol) DO UPDATE SET
       last_close_time = EXCLUDED.last_close_time,
       last_close = EXCLUDED.last_close,
       previous_trend = CASE WHEN $12 THEN trend_states.trend ELSE trend_states.previous_trend END,
       changed_at = CASE WHEN $12 THEN now() ELSE trend_states.changed_at END,
       trend = EXCLUDED.trend,
       event = EXCLUDED.event,
       ema = EXCLUDED.ema,
       ema_period = EXCLUDED.ema_period,
       above_ema = EXCLUDED.above_ema,
       swing_highs = EXCLUDED.swing_highs,
       swing_lows = EXCLUDED.swing_lows,
       reasons = EXCLUDED.reasons,
       computed_at = now()
     RETURNING ${COLUMNS}`,
    [
      input.symbol,
      input.lastCloseTime,
      input.lastClose,
      input.trend,
      input.event,
      input.ema,
      input.emaPeriod,
      input.aboveEma,
      JSON.stringify(input.swingHighs),
      JSON.stringify(input.swingLows),
      JSON.stringify(input.reasons),
      labelChanged,
    ],
  );
  return { row: toRow(rows[0]), newClose, labelChanged, newEvent };
}

/**
 * Claims a UTC day's digest. Returns true only for the caller that inserted
 * the row — a second worker, or the same one after a restart, gets false and
 * must not send.
 */
export async function claimDailyDigest(pool: Pool, day: string): Promise<boolean> {
  const { rowCount } = await pool.query(`INSERT INTO daily_digests (day) VALUES ($1::date) ON CONFLICT (day) DO NOTHING`, [day]);
  return (rowCount ?? 0) > 0;
}

export async function recordDigestRecipients(pool: Pool, day: string, recipients: number): Promise<void> {
  await pool.query(`UPDATE daily_digests SET recipients = $2 WHERE day = $1::date`, [day, recipients]);
}
