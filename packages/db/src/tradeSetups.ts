import type { Pool } from 'pg';
import { compareToBaseline, type EdgeVerdict } from './edge.js';

export type SetupKind = 'pullback' | 'breakout_retest';
export type SetupStatus = 'open' | 'target' | 'stop' | 'expired';
/** Whose bars found the setup — and the only bars it is ever resolved with. */
export type SetupExchange = 'binance' | 'okx';
/**
 * Which coins a setup was found in: the tracked symbols, a scanned coin on
 * that day's watchlist, or any other scanned coin (the baseline, never alerted).
 */
export type SetupCohort = 'core' | 'watchlist' | 'scan';
export const SETUP_COHORTS: readonly SetupCohort[] = ['core', 'watchlist', 'scan'];

/** What put a scanned coin in its cohort on the day the setup was found. */
export interface SetupContext {
  scanDay: string;
  rs30d: number | null;
  flow: string;
}

/** BTC's daily structure read when the setup was found. */
export type BtcTrend = 'up' | 'down' | 'sideways';

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
  exchange: SetupExchange;
  cohort: SetupCohort;
  context: SetupContext | null;
  /** Null for setups found before it was recorded, or when BTC's trend could not be read. */
  btcTrend: BtcTrend | null;
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
  /** Defaults to Binance, which is what every setup before the OKX fallback was. */
  exchange?: SetupExchange;
  /** Defaults to core: every setup before the coin scan fed the detector. */
  cohort?: SetupCohort;
  context?: SetupContext | null;
  btcTrend?: BtcTrend | null;
}

const COLUMNS = `id, symbol, kind, level, entry, stop, target, rr, atr, reasons, status, r_multiple, exchange, cohort, context, btc_trend,
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
    exchange: (r['exchange'] as SetupExchange | undefined) ?? 'binance',
    cohort: (r['cohort'] as SetupCohort | undefined) ?? 'core',
    context: (r['context'] as SetupContext | null | undefined) ?? null,
    btcTrend: (r['btc_trend'] as BtcTrend | null | undefined) ?? null,
  };
}

/** Inserts a setup unless this symbol/kind/bar is already recorded. Returns the row only when it is new — that is the alert trigger. */
export async function insertTradeSetup(pool: Pool, s: NewTradeSetup): Promise<TradeSetupRow | null> {
  const { rows } = await pool.query(
    `INSERT INTO trade_setups (symbol, kind, bar_open_time, level, entry, stop, target, rr, atr, reasons, exchange, cohort, context, btc_trend)
     VALUES ($1, $2, to_timestamp($3/1000.0), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (symbol, kind, bar_open_time) DO NOTHING
     RETURNING ${COLUMNS}`,
    [s.symbol, s.kind, s.barOpenTime, s.level, s.entry, s.stop, s.target, s.rr, s.atr, JSON.stringify(s.reasons), s.exchange ?? 'binance', s.cohort ?? 'core', s.context ? JSON.stringify(s.context) : null, s.btcTrend ?? null],
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

/** Recent first, from the given cohorts only — the baseline would otherwise bury the setups anyone is told about. */
export async function getRecentTradeSetups(pool: Pool, limit = 30, cohorts: readonly SetupCohort[] = SETUP_COHORTS): Promise<TradeSetupRow[]> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM trade_setups WHERE cohort = ANY($2::text[]) ORDER BY detected_at DESC LIMIT $1`, [
    limit,
    cohorts,
  ]);
  return rows.map(toRow);
}

export interface TradeSetupStats {
  cohort: SetupCohort;
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
    `SELECT cohort, kind,
            count(*) AS total,
            count(*) FILTER (WHERE status = 'open') AS open,
            count(*) FILTER (WHERE status <> 'open') AS resolved,
            count(*) FILTER (WHERE status = 'target') AS targets,
            count(*) FILTER (WHERE status = 'stop') AS stops,
            count(*) FILTER (WHERE status = 'expired') AS expired,
            avg(r_multiple) FILTER (WHERE status <> 'open') AS avg_r
     FROM trade_setups GROUP BY cohort, kind ORDER BY cohort, kind`,
  );
  return rows.map((r) => ({
    cohort: r.cohort as SetupCohort,
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

export interface SetupCohortGroup {
  resolved: number;
  targets: number;
  /** Share of resolved setups that reached the target. Null with none resolved. */
  hitPct: number | null;
  avgR: number | null;
}

export interface SetupCohortComparison {
  watchlist: SetupCohortGroup;
  scan: SetupCohortGroup;
  /** Null until both sides have `minResolved` resolved setups. */
  verdict: EdgeVerdict | null;
  deltaPp: number | null;
  marginPp: number | null;
}

function cohortGroup(stats: TradeSetupStats[], cohort: SetupCohort): SetupCohortGroup {
  const rows = stats.filter((s) => s.cohort === cohort);
  const resolved = rows.reduce((n, s) => n + s.resolved, 0);
  const targets = rows.reduce((n, s) => n + s.targets, 0);
  const rSum = rows.reduce((n, s) => n + (s.avgR ?? 0) * s.resolved, 0);
  return { resolved, targets, hitPct: resolved > 0 ? (targets / resolved) * 100 : null, avgR: resolved > 0 ? rSum / resolved : null };
}

/**
 * Does picking strong coins first find better setups? Watchlist setups
 * against every other scanned coin's, from the same detector over the same
 * days — the same test signals get against their baseline. Both kinds
 * pooled: split by kind, neither side would reach the floor for months.
 */
export function compareSetupCohorts(stats: TradeSetupStats[], minResolved: number): SetupCohortComparison {
  const watchlist = cohortGroup(stats, 'watchlist');
  const scan = cohortGroup(stats, 'scan');
  if (watchlist.resolved < minResolved || scan.resolved < minResolved || watchlist.hitPct === null || scan.hitPct === null) {
    return { watchlist, scan, verdict: null, deltaPp: null, marginPp: null };
  }
  const { verdict, deltaPp, marginPp } = compareToBaseline(watchlist.hitPct, watchlist.resolved, scan.hitPct, scan.resolved);
  return { watchlist, scan, verdict, deltaPp, marginPp };
}

/** Resolved setups by whether BTC's daily trend was down when each was found. */
export interface SetupBtcTrendStats {
  btcDown: SetupCohortGroup;
  btcNotDown: SetupCohortGroup;
}

function group(resolved: number, targets: number, avgR: number | null): SetupCohortGroup {
  return { resolved, targets, hitPct: resolved > 0 ? (targets / resolved) * 100 : null, avgR: resolved > 0 ? avgR : null };
}

/**
 * Every cohort pooled, BTC's own setups left out: the detector never
 * offers one while BTC is down (a pullback needs an uptrend, a retest
 * anything but a downtrend), so they would only pad the other side.
 * Rows without a recorded trend are left out rather than guessed.
 */
export async function getSetupBtcTrendStats(pool: Pool): Promise<SetupBtcTrendStats> {
  const { rows } = await pool.query(
    `SELECT btc_trend = 'down' AS down,
            count(*) AS resolved,
            count(*) FILTER (WHERE status = 'target') AS targets,
            avg(r_multiple) AS avg_r
     FROM trade_setups
     WHERE status <> 'open' AND btc_trend IS NOT NULL AND symbol <> 'BTCUSDT'
     GROUP BY 1`,
  );
  const pick = (down: boolean): SetupCohortGroup => {
    const r = rows.find((x) => x.down === down);
    return r ? group(Number(r.resolved), Number(r.targets), r.avg_r === null ? null : Number(r.avg_r)) : group(0, 0, null);
  };
  return { btcDown: pick(true), btcNotDown: pick(false) };
}

export interface SetupBtcTrendComparison extends SetupBtcTrendStats {
  /** "worse" means setups found while BTC was down hit the target less often. Null until both sides have `minResolved`. */
  verdict: EdgeVerdict | null;
  deltaPp: number | null;
  marginPp: number | null;
}

/**
 * Should an altcoin setup be skipped while BTC is in a daily downtrend?
 * The setups found then, judged against the ones found otherwise, with the
 * same test as the watchlist comparison.
 */
export function compareSetupBtcTrend(stats: SetupBtcTrendStats, minResolved: number): SetupBtcTrendComparison {
  const { btcDown, btcNotDown } = stats;
  if (btcDown.resolved < minResolved || btcNotDown.resolved < minResolved || btcDown.hitPct === null || btcNotDown.hitPct === null) {
    return { ...stats, verdict: null, deltaPp: null, marginPp: null };
  }
  const { verdict, deltaPp, marginPp } = compareToBaseline(btcDown.hitPct, btcDown.resolved, btcNotDown.hitPct, btcNotDown.resolved);
  return { ...stats, verdict, deltaPp, marginPp };
}
