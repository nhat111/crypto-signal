import type { Pool } from 'pg';

export type SpotBreakoutStatus = 'open' | 'stop' | 'trail';
export type SpotBreakoutExchange = 'binance' | 'okx';

export interface SpotBreakoutRow {
  id: string;
  symbol: string;
  exchange: SpotBreakoutExchange;
  barOpenTime: number;
  detectedAt: number;
  entry: number;
  stop: number;
  high20: number;
  trail: number;
  status: SpotBreakoutStatus;
  exitPrice: number | null;
  exitTime: number | null;
  returnPct: number | null;
  rMultiple: number | null;
}

export interface NewSpotBreakout {
  symbol: string;
  exchange: SpotBreakoutExchange;
  barOpenTime: number;
  entry: number;
  stop: number;
  high20: number;
}

const COLUMNS = `id, symbol, exchange, entry, stop, high20, trail, status, exit_price, return_pct, r_multiple,
  extract(epoch from bar_open_time)*1000 AS bar_open_ms,
  extract(epoch from detected_at)*1000 AS detected_ms,
  extract(epoch from exit_time)*1000 AS exit_ms`;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toRow(r: Record<string, unknown>): SpotBreakoutRow {
  return {
    id: String(r['id']),
    symbol: r['symbol'] as string,
    exchange: r['exchange'] as SpotBreakoutExchange,
    barOpenTime: Number(r['bar_open_ms']),
    detectedAt: Number(r['detected_ms']),
    entry: Number(r['entry']),
    stop: Number(r['stop']),
    high20: Number(r['high20']),
    trail: Number(r['trail']),
    status: r['status'] as SpotBreakoutStatus,
    exitPrice: num(r['exit_price']),
    exitTime: num(r['exit_ms']),
    returnPct: num(r['return_pct']),
    rMultiple: num(r['r_multiple']),
  };
}

/**
 * Records a breakout unless this coin already has one on that day or one
 * still open: the replay held one position per coin, and the partial
 * unique index enforces the same. Returns the row only when it is new.
 */
export async function insertSpotBreakout(pool: Pool, b: NewSpotBreakout): Promise<SpotBreakoutRow | null> {
  const { rows } = await pool.query(
    `INSERT INTO spot_breakouts (symbol, exchange, bar_open_time, entry, stop, high20, trail)
     VALUES ($1, $2, to_timestamp($3/1000.0), $4, $5, $6, $5)
     ON CONFLICT DO NOTHING
     RETURNING ${COLUMNS}`,
    [b.symbol, b.exchange, b.barOpenTime, b.entry, b.stop, b.high20],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

export async function getOpenSpotBreakouts(pool: Pool): Promise<SpotBreakoutRow[]> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM spot_breakouts WHERE status = 'open' ORDER BY bar_open_time DESC, symbol`);
  return rows.map(toRow);
}

/** Raises the stored trailing line; never lowers it, whatever the caller passes. */
export async function updateSpotBreakoutTrail(pool: Pool, id: string, trail: number): Promise<void> {
  await pool.query(`UPDATE spot_breakouts SET trail = GREATEST(trail, $2) WHERE id = $1 AND status = 'open'`, [id, trail]);
}

export async function closeSpotBreakout(
  pool: Pool,
  id: string,
  exit: { status: Exclude<SpotBreakoutStatus, 'open'>; trail: number; exitPrice: number; exitTime: number; returnPct: number; rMultiple: number },
): Promise<void> {
  await pool.query(
    `UPDATE spot_breakouts
     SET status = $2, trail = GREATEST(trail, $3), exit_price = $4, exit_time = to_timestamp($5/1000.0), return_pct = $6, r_multiple = $7
     WHERE id = $1 AND status = 'open'`,
    [id, exit.status, exit.trail, exit.exitPrice, exit.exitTime, exit.returnPct, exit.rMultiple],
  );
}

export async function getRecentClosedSpotBreakouts(pool: Pool, limit = 20): Promise<SpotBreakoutRow[]> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM spot_breakouts WHERE status <> 'open' ORDER BY exit_time DESC LIMIT $1`, [limit]);
  return rows.map(toRow);
}

export interface SpotBreakoutStats {
  closed: number;
  wins: number;
  avgR: number | null;
  sumR: number;
  avgReturnPct: number | null;
}

export async function getSpotBreakoutStats(pool: Pool): Promise<SpotBreakoutStats> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS closed, count(*) FILTER (WHERE r_multiple > 0)::int AS wins,
            avg(r_multiple) AS avg_r, coalesce(sum(r_multiple), 0) AS sum_r, avg(return_pct) AS avg_ret
     FROM spot_breakouts WHERE status <> 'open'`,
  );
  const r = rows[0] as Record<string, unknown>;
  return { closed: Number(r['closed']), wins: Number(r['wins']), avgR: num(r['avg_r']), sumR: Number(r['sum_r']), avgReturnPct: num(r['avg_ret']) };
}

export interface SpotBreakoutRun {
  day: string;
  regimeUp: boolean;
  btcClose: number;
  btcEma50: number;
  btcEma200: number;
  coinsRead: number;
  found: number;
  closed: number;
  ranAt: number;
}

export async function upsertSpotBreakoutRun(pool: Pool, run: Omit<SpotBreakoutRun, 'ranAt'>): Promise<void> {
  await pool.query(
    `INSERT INTO spot_breakout_runs (day, regime_up, btc_close, btc_ema50, btc_ema200, coins_read, found, closed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (day) DO UPDATE SET regime_up = EXCLUDED.regime_up, btc_close = EXCLUDED.btc_close, btc_ema50 = EXCLUDED.btc_ema50,
       btc_ema200 = EXCLUDED.btc_ema200, coins_read = EXCLUDED.coins_read, found = EXCLUDED.found, closed = EXCLUDED.closed, ran_at = now()`,
    [run.day, run.regimeUp, run.btcClose, run.btcEma50, run.btcEma200, run.coinsRead, run.found, run.closed],
  );
}

export async function getLatestSpotBreakoutRun(pool: Pool): Promise<SpotBreakoutRun | null> {
  const { rows } = await pool.query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, regime_up, btc_close, btc_ema50, btc_ema200, coins_read, found, closed,
            extract(epoch from ran_at)*1000 AS ran_ms
     FROM spot_breakout_runs ORDER BY day DESC LIMIT 1`,
  );
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    day: r['day'] as string,
    regimeUp: Boolean(r['regime_up']),
    btcClose: Number(r['btc_close']),
    btcEma50: Number(r['btc_ema50']),
    btcEma200: Number(r['btc_ema200']),
    coinsRead: Number(r['coins_read']),
    found: Number(r['found']),
    closed: Number(r['closed']),
    ranAt: Number(r['ran_ms']),
  };
}
