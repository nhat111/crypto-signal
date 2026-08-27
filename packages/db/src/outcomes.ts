import type { Pool } from 'pg';
import type { DataSource } from './provenance.js';

export type OutcomeHorizon = '15m' | '1h' | '4h' | '24h';

const HORIZON_MS: Record<OutcomeHorizon, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
};

const HORIZON_PRICE_COLUMN: Record<OutcomeHorizon, string> = {
  '15m': 'price_after_15m',
  '1h': 'price_after_1h',
  '4h': 'price_after_4h',
  '24h': 'price_after_24h',
};

const HORIZON_MOVE_COLUMN: Record<OutcomeHorizon, string> = {
  '15m': 'move_after_15m_pct',
  '1h': 'move_after_1h_pct',
  '4h': 'move_after_4h_pct',
  '24h': 'move_after_24h_pct',
};

/**
 * How far past a signal's due time a candle may be and still answer "what
 * was the price at signal + horizon". Must stay in step with the caller —
 * it lives here because the resolvability check below is what decides
 * whether a row is even offered for resolution.
 */
const OUTCOME_LOOKAHEAD_MS = 30 * 60_000;

export interface ResolvableOutcomeRow {
  signalId: string;
  priceAtSignal: number;
  /** Close of the first futures 5m candle at or after signal time + horizon. */
  closeAtHorizon: number;
}

/**
 * Signals whose outcome can be recorded *right now*: the horizon has
 * elapsed AND a futures 5m candle exists to price it against.
 *
 * The resolvability check is deliberately inside the query rather than in
 * the caller's loop. When it lived in the loop, a row that could never
 * resolve — no candle near its due time — stayed NULL forever, and since
 * the page is ordered oldest-first and capped, the same dead rows were
 * re-fetched every pass and newer signals were never reached at all. That
 * is a permanent head-of-line block, and it is silent: the job logs a
 * healthy "200 pending" every time while recording nothing.
 *
 * Replayed history made it acute — it writes signals dated up to 30 days
 * back, which sort ahead of everything live — but the bug was always
 * there for any live signal whose candle went missing.
 *
 * Doing the lookup in SQL also collapses what was one query per row (200
 * per horizon per pass, 800 every five minutes) into one.
 *
 * Rows stay eligible rather than being marked dead: if the candles they
 * need are written later by a backfill, they simply start resolving.
 */
export async function getResolvableOutcomes(
  pool: Pool,
  horizon: OutcomeHorizon,
  nowMs: number,
  limit = 200,
  source?: DataSource,
): Promise<ResolvableOutcomeRow[]> {
  const dueBeforeMs = nowMs - HORIZON_MS[horizon];
  const priceCol = HORIZON_PRICE_COLUMN[horizon];
  const horizonMs = HORIZON_MS[horizon];

  const params: unknown[] = [dueBeforeMs, horizonMs, horizonMs + OUTCOME_LOOKAHEAD_MS, limit];
  if (source) params.push(source);

  const { rows } = await pool.query(
    `SELECT o.signal_id, o.price_at_signal, later.close
     FROM signal_outcomes o
     JOIN market_signals s ON s.signal_id = o.signal_id
     JOIN LATERAL (
       SELECT mc.close
       FROM market_candles mc
       WHERE mc.symbol = s.symbol AND mc.market = 'futures' AND mc.timeframe = '5m'
         AND mc.open_time >= s.timestamp + ($2 || ' milliseconds')::interval
         AND mc.open_time <= s.timestamp + ($3 || ' milliseconds')::interval
       ORDER BY mc.open_time ASC
       LIMIT 1
     ) later ON TRUE
     WHERE o.${priceCol} IS NULL AND s.timestamp <= to_timestamp($1/1000.0)
       ${source ? 'AND s.source = $5' : ''}
     ORDER BY s.timestamp ASC
     LIMIT $4`,
    params,
  );

  return rows.map((r) => ({
    signalId: r.signal_id,
    priceAtSignal: Number(r.price_at_signal),
    closeAtHorizon: Number(r.close),
  }));
}

/**
 * How many signals are still waiting on this horizon, resolvable or not.
 *
 * Reported alongside the resolved count so a backlog that cannot be priced
 * stays visible — otherwise filtering the unresolvable rows out of the work
 * queue would also hide the fact that they exist.
 */
export async function countPendingOutcomes(
  pool: Pool,
  horizon: OutcomeHorizon,
  nowMs: number,
  source?: DataSource,
): Promise<number> {
  const dueBeforeMs = nowMs - HORIZON_MS[horizon];
  const priceCol = HORIZON_PRICE_COLUMN[horizon];

  const { rows } = await pool.query(
    `SELECT count(*)::int AS n
     FROM signal_outcomes o
     JOIN market_signals s ON s.signal_id = o.signal_id
     WHERE o.${priceCol} IS NULL AND s.timestamp <= to_timestamp($1/1000.0)
       ${source ? 'AND s.source = $2' : ''}`,
    source ? [dueBeforeMs, source] : [dueBeforeMs],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function recordOutcomePrice(pool: Pool, signalId: string, horizon: OutcomeHorizon, price: number, priceAtSignal: number): Promise<void> {
  const priceCol = HORIZON_PRICE_COLUMN[horizon];
  const moveCol = HORIZON_MOVE_COLUMN[horizon];
  const movePct = priceAtSignal > 0 ? ((price - priceAtSignal) / priceAtSignal) * 100 : 0;

  await pool.query(
    `UPDATE signal_outcomes SET ${priceCol} = $1, ${moveCol} = $2, updated_at = now() WHERE signal_id = $3`,
    [price, movePct, signalId],
  );
}

export interface SignalPerformance {
  signalType: string;
  sampleCount: number;
  horizon: OutcomeHorizon;
  /** Which provenance these samples came from; undefined means both were counted together. */
  source?: DataSource;
  positiveMovePct: number | null;
  negativeMovePct: number | null;
  medianMovePct: number | null;
  /** Minimum sample size before we'll report a number at all (spec §24: "phải được tính từ historical data thực tế", never claimed without evidence). */
  sufficientData: boolean;
}

const MIN_SAMPLES = 30;

export async function getSignalPerformance(pool: Pool, signalType: string, horizon: OutcomeHorizon, source?: DataSource): Promise<SignalPerformance> {
  const moveCol = HORIZON_MOVE_COLUMN[horizon];

  const { rows } = await pool.query(
    `SELECT o.${moveCol} AS move
     FROM signal_outcomes o
     JOIN market_signals s ON s.signal_id = o.signal_id
     WHERE s.signal_type = $1 AND o.${moveCol} IS NOT NULL
       ${source ? 'AND s.source = $2' : ''}`,
    source ? [signalType, source] : [signalType],
  );

  const moves = rows.map((r) => Number(r.move)).sort((a, b) => a - b);
  const sampleCount = moves.length;

  if (sampleCount === 0) {
    return { signalType, sampleCount, horizon, source, positiveMovePct: null, negativeMovePct: null, medianMovePct: null, sufficientData: false };
  }

  const positive = moves.filter((m) => m > 0).length;
  const negative = moves.filter((m) => m < 0).length;
  const mid = Math.floor(moves.length / 2);
  const median = moves.length % 2 === 0 ? ((moves[mid - 1] as number) + (moves[mid] as number)) / 2 : (moves[mid] as number);

  return {
    signalType,
    sampleCount,
    horizon,
    source,
    positiveMovePct: Math.round((positive / sampleCount) * 1000) / 10,
    negativeMovePct: Math.round((negative / sampleCount) * 1000) / 10,
    medianMovePct: Math.round(median * 100) / 100,
    sufficientData: sampleCount >= MIN_SAMPLES,
  };
}

export interface BaselinePerformance {
  horizon: OutcomeHorizon;
  sampleCount: number;
  positiveMovePct: number | null;
  medianMovePct: number | null;
  /** The window measured, so the UI can say whether it really matches the signals' period. Null when there are no outcomes to bound it by. */
  fromMs: number | null;
  toMs: number | null;
}

/**
 * What price did over the same horizon from an *arbitrary* moment — the
 * control a signal has to beat.
 *
 * Without it "55% positive" is unreadable: if price rises 55% of the time
 * anyway, the signal selected for nothing. Deliberately measured the same
 * way as signal outcomes — first futures 5m candle at or after T + horizon,
 * same 30-minute tolerance, same symbols — because a control measured
 * differently from the thing it controls for is worse than none.
 *
 * The window is bounded to the period the recorded outcomes span, so the
 * two are compared across the same market regime rather than the signal's
 * week against the collector's whole history.
 */
export async function getBaselinePerformance(pool: Pool, horizon: OutcomeHorizon, source?: DataSource): Promise<BaselinePerformance> {
  const moveCol = HORIZON_MOVE_COLUMN[horizon];
  const horizonMs = HORIZON_MS[horizon];
  const LOOKAHEAD_MS = 30 * 60_000;

  const { rows: bounds } = await pool.query(
    `SELECT extract(epoch from min(s.timestamp))*1000 AS from_ms,
            extract(epoch from max(s.timestamp))*1000 AS to_ms
     FROM signal_outcomes o
     JOIN market_signals s ON s.signal_id = o.signal_id
     WHERE o.${moveCol} IS NOT NULL
       ${source ? 'AND s.source = $1' : ''}`,
    source ? [source] : [],
  );
  const fromMs = bounds[0]?.from_ms === null || bounds[0]?.from_ms === undefined ? null : Number(bounds[0].from_ms);
  const toMs = bounds[0]?.to_ms === null || bounds[0]?.to_ms === undefined ? null : Number(bounds[0].to_ms);

  if (fromMs === null || toMs === null) {
    return { horizon, sampleCount: 0, positiveMovePct: null, medianMovePct: null, fromMs: null, toMs: null };
  }

  // Aggregated in SQL rather than pulled row by row: this scans every 5m
  // candle in the window across all symbols, which is far more rows than
  // any single signal type produces. percentile_cont(0.5) is the same
  // midpoint-of-two-middle-values the JS path computes for even counts.
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE later.close > base.close)::int AS positive,
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY (later.close - base.close) / base.close * 100
            ) AS median_move
     FROM market_candles base
     JOIN LATERAL (
       SELECT mc.close
       FROM market_candles mc
       WHERE mc.symbol = base.symbol AND mc.market = 'futures' AND mc.timeframe = '5m'
         AND mc.open_time >= base.open_time + ($1 || ' milliseconds')::interval
         AND mc.open_time <= base.open_time + ($2 || ' milliseconds')::interval
       ORDER BY mc.open_time ASC
       LIMIT 1
     ) later ON TRUE
     WHERE base.market = 'futures' AND base.timeframe = '5m'
       AND base.open_time >= to_timestamp($3/1000.0)
       AND base.open_time <= to_timestamp($4/1000.0)
       AND base.close > 0`,
    [horizonMs, horizonMs + LOOKAHEAD_MS, fromMs, toMs],
  );

  const n = Number(rows[0]?.n ?? 0);
  if (n === 0) {
    return { horizon, sampleCount: 0, positiveMovePct: null, medianMovePct: null, fromMs, toMs };
  }

  return {
    horizon,
    sampleCount: n,
    positiveMovePct: Math.round((Number(rows[0].positive) / n) * 1000) / 10,
    medianMovePct: Math.round(Number(rows[0].median_move) * 100) / 100,
    fromMs,
    toMs,
  };
}

/** Historical score feed for the signal engine's confidence formula (spec §30 term, ASSUMPTIONS.md §8) — defaults to undefined (-> neutral 50) below MIN_SAMPLES. */
export async function getHistoricalScoreForSignalType(pool: Pool, signalType: string, source: DataSource = 'live'): Promise<number | undefined> {
  const perf = await getSignalPerformance(pool, signalType, '1h', source);
  if (!perf.sufficientData || perf.positiveMovePct === null) return undefined;
  return Math.round(perf.positiveMovePct);
}
