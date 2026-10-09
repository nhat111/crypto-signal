import type { Pool } from 'pg';

export type SetupKind = 'pullback' | 'breakout_retest';
export type SetupStatus = 'open' | 'target' | 'stop' | 'expired';

export interface TradeSetupRow {
  id: string;
  symbol: string;
  kind: SetupKind;
  barOpenTime: number;
  detectedAt: number;
  level: number;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  atr: number;
  reasons: string[];
  status: SetupStatus;
  resolvedAt: number | null;
  rMultiple: number | null;
}

export interface NewTradeSetup {
  symbol: string;
  kind: SetupKind;
  barOpenTime: number;
  level: number;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  atr: number;
  reasons: string[];
}

const COLUMNS = `id, symbol, kind, level, entry, stop, target, rr, atr, reasons, status, r_multiple,
  extract(epoch from bar_open_time)*1000 AS bar_open_ms,
  extract(epoch from detected_at)*1000 AS detected_ms,
  extract(epoch from resolved_at)*1000 AS resolved_ms`;

function toRow(r: Record<string, unknown>): TradeSetupRow {
  return {
    id: String(r['id']),
    symbol: r['symbol'] as string,
    kind: r['kind'] as SetupKind,
    barOpenTime: Number(r['bar_open_ms']),
    detectedAt: Number(r['detected_ms']),
    level: Number(r['level']),
    entry: Number(r['entry']),
    stop: Number(r['stop']),
    target: Number(r['target']),
    rr: Number(r['rr']),
    atr: Number(r['atr']),
    reasons: r['reasons'] as string[],
    status: r['status'] as SetupStatus,
    resolvedAt: r['resolved_ms'] === null ? null : Number(r['resolved_ms']),
    rMultiple: r['r_multiple'] === null ? null : Number(r['r_multiple']),
  };
}

/** Inserts a setup unless this symbol/kind/bar is already recorded. Returns the row only when it is new — that is the alert trigger. */
export async function insertTradeSetup(pool: Pool, s: NewTradeSetup): Promise<TradeSetupRow | null> {
  const { rows } = await pool.query(
    `INSERT INTO trade_setups (symbol, kind, bar_open_time, level, entry, stop, target, rr, atr, reasons)
     VALUES ($1, $2, to_timestamp($3/1000.0), $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (symbol, kind, bar_open_time) DO NOTHING
     RETURNING ${COLUMNS}`,
    [s.symbol, s.kind, s.barOpenTime, s.level, s.entry, s.stop, s.target, s.rr, s.atr, JSON.stringify(s.reasons)],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

export async function getOpenTradeSetups(pool: Pool): Promise<TradeSetupRow[]> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM trade_setups WHERE status = 'open' ORDER BY detected_at`);
  return rows.map(toRow);
}

export async function resolveTradeSetup(
  pool: Pool,
  id: string,
  status: Exclude<SetupStatus, 'open'>,
  resolvedAt: number,
  rMultiple: number,
): Promise<void> {
  await pool.query(
    `UPDATE trade_setups SET status = $2, resolved_at = to_timestamp($3/1000.0), r_multiple = $4 WHERE id = $1 AND status = 'open'`,
    [id, status, resolvedAt, rMultiple],
  );
}

export async function getRecentTradeSetups(pool: Pool, limit = 30): Promise<TradeSetupRow[]> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM trade_setups ORDER BY detected_at DESC LIMIT $1`, [limit]);
  return rows.map(toRow);
}

export interface TradeSetupStats {
  kind: SetupKind;
  total: number;
  open: number;
  resolved: number;
  targets: number;
  stops: number;
  expired: number;
  /** Null until something has resolved. */
  avgR: number | null;
}

export async function getTradeSetupStats(pool: Pool): Promise<TradeSetupStats[]> {
  const { rows } = await pool.query(
    `SELECT kind,
            count(*) AS total,
            count(*) FILTER (WHERE status = 'open') AS open,
            count(*) FILTER (WHERE status <> 'open') AS resolved,
            count(*) FILTER (WHERE status = 'target') AS targets,
            count(*) FILTER (WHERE status = 'stop') AS stops,
            count(*) FILTER (WHERE status = 'expired') AS expired,
            avg(r_multiple) FILTER (WHERE status <> 'open') AS avg_r
     FROM trade_setups GROUP BY kind ORDER BY kind`,
  );
  return rows.map((r) => ({
    kind: r.kind as SetupKind,
    total: Number(r.total),
    open: Number(r.open),
    resolved: Number(r.resolved),
    targets: Number(r.targets),
    stops: Number(r.stops),
    expired: Number(r.expired),
    avgR: r.avg_r === null ? null : Number(r.avg_r),
  }));
}
