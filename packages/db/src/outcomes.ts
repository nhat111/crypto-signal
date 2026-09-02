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

export interface OutcomeTrackerHorizonStatus {
  horizon: OutcomeHorizon;
  resolved: number;
  /** Due but still unpriced — resolvable or not. */
  pending: number;
  /** Of those, how many could be priced on the next pass. */
  resolvableNow: number;
  /** Oldest signal still waiting. A number that never moves means its candles are missing, not that the job is behind. */
  oldestPendingAt: number | null;
}

/**
 * What the outcome tracker is actually keeping up with.
 *
 * `pending` alone cannot say whether the job is behind or stuck: a backlog
 * being worked through and a backlog that can never be priced look the
 * same. `resolvableNow` separates them — zero resolvable against a large
 * pending count means the candles those signals need do not exist, and no
 * amount of waiting will change it.
 */
export async function getOutcomeTrackerStatus(pool: Pool, nowMs: number = Date.now()): Promise<OutcomeTrackerHorizonStatus[]> {
  const horizons: OutcomeHorizon[] = ['15m', '1h', '4h', '24h'];
  const out: OutcomeTrackerHorizonStatus[] = [];

  for (const horizon of horizons) {
    const moveCol = HORIZON_MOVE_COLUMN[horizon];
    const priceCol = HORIZON_PRICE_COLUMN[horizon];
    const dueBeforeMs = nowMs - HORIZON_MS[horizon];

    const { rows } = await pool.query(
      `SELECT
         count(*) FILTER (WHERE o.${moveCol} IS NOT NULL)::int AS resolved,
         count(*) FILTER (WHERE o.${priceCol} IS NULL AND s.timestamp <= to_timestamp($1/1000.0))::int AS pending,
         extract(epoch from min(s.timestamp) FILTER (
           WHERE o.${priceCol} IS NULL AND s.timestamp <= to_timestamp($1/1000.0)
         ))*1000 AS oldest_ms
       FROM signal_outcomes o
       JOIN market_signals s ON s.signal_id = o.signal_id`,
      [dueBeforeMs],
    );

    // Counted through the same query the tracker works from, so this can
    // never disagree with what the next pass will actually manage.
    const resolvableNow = (await getResolvableOutcomes(pool, horizon, nowMs, 1000)).length;

    const r = rows[0];
    out.push({
      horizon,
      resolved: Number(r?.resolved ?? 0),
      pending: Number(r?.pending ?? 0),
      resolvableNow,
      oldestPendingAt: r?.oldest_ms == null ? null : Math.round(Number(r.oldest_ms)),
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

/**
 * Why the two functions below exist.
 *
 * `resolvableNow: 0` against `pending: 244` says the backlog cannot be
 * priced, but not why — and the three causes need different fixes: the
 * signals predate the candles, the candles have a hole where those
 * signals sit, or the resolver's own window is wrong. Telling them apart
 * meant a psql session, which on this platform means a laptop; the
 * operator is on a phone, and a phone is exactly where a silent failure
 * gets to stay silent.
 *
 * Both are scans, so they are on a route the status page fetches only
 * when asked, never on its 30-second poll.
 */

export interface PricingCandleCoverage {
  symbol: string;
  /** Futures 5m candles stored — the ruler every outcome is measured with. */
  candles: number;
  earliestAt: number | null;
  latestAt: number | null;
}

export async function getPricingCandleCoverage(pool: Pool): Promise<PricingCandleCoverage[]> {
  const { rows } = await pool.query(
    `SELECT symbol,
            count(*)::int AS candles,
            extract(epoch from min(open_time))*1000 AS earliest_ms,
            extract(epoch from max(open_time))*1000 AS latest_ms
     FROM market_candles
     WHERE market = 'futures' AND timeframe = '5m'
     GROUP BY symbol
     ORDER BY symbol`,
  );

  return rows.map((r) => ({
    symbol: String(r.symbol),
    candles: Number(r.candles),
    earliestAt: r.earliest_ms == null ? null : Math.round(Number(r.earliest_ms)),
    latestAt: r.latest_ms == null ? null : Math.round(Number(r.latest_ms)),
  }));
}

export interface StuckOutcomeRow {
  symbol: string;
  timeframe: string;
  signalType: string;
  timestamp: number;
  source: string;
  /**
   * Candles inside the exact window the resolver searches. Zero is the
   * answer to "will waiting help" — no.
   */
  candlesInWindow: number;
}

/**
 * The oldest signals this horizon cannot price, each with the count of
 * candles in its pricing window.
 *
 * The window is built from the same two constants `getResolvableOutcomes`
 * uses, so the diagnostic can never disagree with the resolver about what
 * it was looking for — a diagnostic that drifts from the thing it
 * diagnoses is worse than none.
 */
export async function getStuckOutcomeSample(
  pool: Pool,
  horizon: OutcomeHorizon,
  nowMs: number = Date.now(),
  limit = 8,
): Promise<StuckOutcomeRow[]> {
  const dueBeforeMs = nowMs - HORIZON_MS[horizon];
  const priceCol = HORIZON_PRICE_COLUMN[horizon];
  const horizonMs = HORIZON_MS[horizon];

  const { rows } = await pool.query(
    `SELECT s.symbol, s.timeframe, s.signal_type, s.source,
            extract(epoch from s.timestamp)*1000 AS ts_ms,
            (SELECT count(*) FROM market_candles mc
              WHERE mc.symbol = s.symbol AND mc.market = 'futures' AND mc.timeframe = '5m'
                AND mc.open_time >= s.timestamp + ($2 || ' milliseconds')::interval
                AND mc.open_time <= s.timestamp + ($3 || ' milliseconds')::interval
            )::int AS candles_in_window
     FROM signal_outcomes o
     JOIN market_signals s ON s.signal_id = o.signal_id
     WHERE o.${priceCol} IS NULL AND s.timestamp <= to_timestamp($1/1000.0)
     ORDER BY s.timestamp ASC
     LIMIT $4`,
    [dueBeforeMs, horizonMs, horizonMs + OUTCOME_LOOKAHEAD_MS, limit],
  );

  return rows.map((r) => ({
    symbol: String(r.symbol),
    timeframe: String(r.timeframe),
    signalType: String(r.signal_type),
    timestamp: Math.round(Number(r.ts_ms)),
    source: String(r.source),
    candlesInWindow: Number(r.candles_in_window),
  }));
}

export interface StuckOutcomeCensus {
  horizon: OutcomeHorizon;
  /** Every row past its horizon and still unpriced. */
  pending: number;
  /** Rows a candle exists for. Non-zero here with resolvableNow at 0 is a contradiction, not a data problem. */
  withCandles: number;
  /** No candle, and the signal is older than the oldest candle held for its symbol. Permanently unpriceable. */
  predateCandles: number;
  /** No candle, but the signal sits inside the stored range — a hole in the candles. */
  insideCoverageNoCandle: number;
}

/**
 * An exact count of why the backlog is stuck, rather than a guess from
 * its oldest rows.
 *
 * `getStuckOutcomeSample` orders oldest-first, which turned out to be a
 * trap: the oldest rows are the permanently dead ones — signals from
 * before any candle exists — so a small ancient tail made every verdict
 * read "signals predate candles" no matter what the other ninety-nine
 * percent of the backlog was doing. A census cannot be dominated that
 * way.
 *
 * One EXISTS per pending row, so it costs in proportion to the backlog,
 * not the candle table. Fine for a route that only runs when asked.
 */
export async function getStuckOutcomeCensus(
  pool: Pool,
  horizon: OutcomeHorizon,
  nowMs: number = Date.now(),
): Promise<StuckOutcomeCensus> {
  const dueBeforeMs = nowMs - HORIZON_MS[horizon];
  const priceCol = HORIZON_PRICE_COLUMN[horizon];
  const horizonMs = HORIZON_MS[horizon];

  const { rows } = await pool.query(
    `WITH coverage AS (
       SELECT symbol, min(open_time) AS earliest
       FROM market_candles
       WHERE market = 'futures' AND timeframe = '5m'
       GROUP BY symbol
     ),
     stuck AS (
       SELECT s.symbol, s.timestamp,
              EXISTS (
                SELECT 1 FROM market_candles mc
                WHERE mc.symbol = s.symbol AND mc.market = 'futures' AND mc.timeframe = '5m'
                  AND mc.open_time >= s.timestamp + ($2 || ' milliseconds')::interval
                  AND mc.open_time <= s.timestamp + ($3 || ' milliseconds')::interval
              ) AS has_candle
       FROM signal_outcomes o
       JOIN market_signals s ON s.signal_id = o.signal_id
       WHERE o.${priceCol} IS NULL AND s.timestamp <= to_timestamp($1/1000.0)
     )
     SELECT
       count(*)::int AS pending,
       count(*) FILTER (WHERE stuck.has_candle)::int AS with_candles,
       count(*) FILTER (
         WHERE NOT stuck.has_candle AND (c.earliest IS NULL OR stuck.timestamp < c.earliest)
       )::int AS predate,
       count(*) FILTER (
         WHERE NOT stuck.has_candle AND c.earliest IS NOT NULL AND stuck.timestamp >= c.earliest
       )::int AS gap
     FROM stuck LEFT JOIN coverage c ON c.symbol = stuck.symbol`,
    [dueBeforeMs, horizonMs, horizonMs + OUTCOME_LOOKAHEAD_MS],
  );

  const r = rows[0];
  return {
    horizon,
    pending: Number(r?.pending ?? 0),
    withCandles: Number(r?.with_candles ?? 0),
    predateCandles: Number(r?.predate ?? 0),
    insideCoverageNoCandle: Number(r?.gap ?? 0),
  };
}
