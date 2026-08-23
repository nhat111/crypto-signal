import type { Pool } from 'pg';

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

export interface PendingOutcomeRow {
  signalId: string;
  symbol: string;
  timeframe: string;
  priceAtSignal: number;
  signalTimestamp: number;
}

/**
 * Signals whose (timestamp + horizon) has passed but whose outcome column
 * for that horizon is still null — exactly what the outcome-tracker job
 * (Phase 9) needs to fill in.
 */
export async function getSignalsPendingOutcome(pool: Pool, horizon: OutcomeHorizon, nowMs: number, limit = 200): Promise<PendingOutcomeRow[]> {
  const dueBeforeMs = nowMs - HORIZON_MS[horizon];
  const priceCol = HORIZON_PRICE_COLUMN[horizon];

  const { rows } = await pool.query(
    `SELECT o.signal_id, s.symbol, s.timeframe, o.price_at_signal, extract(epoch from s.timestamp)*1000 AS ts
     FROM signal_outcomes o
     JOIN market_signals s ON s.signal_id = o.signal_id
     WHERE o.${priceCol} IS NULL AND s.timestamp <= to_timestamp($1/1000.0)
     ORDER BY s.timestamp ASC
     LIMIT $2`,
    [dueBeforeMs, limit],
  );

  return rows.map((r) => ({
    signalId: r.signal_id,
    symbol: r.symbol,
    timeframe: r.timeframe,
    priceAtSignal: Number(r.price_at_signal),
    signalTimestamp: Number(r.ts),
  }));
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
  positiveMovePct: number | null;
  negativeMovePct: number | null;
  medianMovePct: number | null;
  /** Minimum sample size before we'll report a number at all (spec §24: "phải được tính từ historical data thực tế", never claimed without evidence). */
  sufficientData: boolean;
}

const MIN_SAMPLES = 30;

export async function getSignalPerformance(pool: Pool, signalType: string, horizon: OutcomeHorizon): Promise<SignalPerformance> {
  const moveCol = HORIZON_MOVE_COLUMN[horizon];

  const { rows } = await pool.query(
    `SELECT o.${moveCol} AS move
     FROM signal_outcomes o
     JOIN market_signals s ON s.signal_id = o.signal_id
     WHERE s.signal_type = $1 AND o.${moveCol} IS NOT NULL`,
    [signalType],
  );

  const moves = rows.map((r) => Number(r.move)).sort((a, b) => a - b);
  const sampleCount = moves.length;

  if (sampleCount === 0) {
    return { signalType, sampleCount, horizon, positiveMovePct: null, negativeMovePct: null, medianMovePct: null, sufficientData: false };
  }

  const positive = moves.filter((m) => m > 0).length;
  const negative = moves.filter((m) => m < 0).length;
  const mid = Math.floor(moves.length / 2);
  const median = moves.length % 2 === 0 ? ((moves[mid - 1] as number) + (moves[mid] as number)) / 2 : (moves[mid] as number);

  return {
    signalType,
    sampleCount,
    horizon,
    positiveMovePct: Math.round((positive / sampleCount) * 1000) / 10,
    negativeMovePct: Math.round((negative / sampleCount) * 1000) / 10,
    medianMovePct: Math.round(median * 100) / 100,
    sufficientData: sampleCount >= MIN_SAMPLES,
  };
}

/** Historical score feed for the signal engine's confidence formula (spec §30 term, ASSUMPTIONS.md §8) — defaults to undefined (-> neutral 50) below MIN_SAMPLES. */
export async function getHistoricalScoreForSignalType(pool: Pool, signalType: string): Promise<number | undefined> {
  const perf = await getSignalPerformance(pool, signalType, '1h');
  if (!perf.sufficientData || perf.positiveMovePct === null) return undefined;
  return Math.round(perf.positiveMovePct);
}
