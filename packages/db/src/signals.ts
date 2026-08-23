import type { Pool } from 'pg';
import type { Signal } from '@crypto-signal/signal-engine';

export interface SignalExtras {
  price: number;
  healthScore: number;
  riskScore: number;
  spotCvd: number;
  futuresCvd: number;
  openInterest: number;
  fundingRate: number;
  volume: number;
}

export interface StoredSignal extends Signal, SignalExtras {
  signalId: string;
}

export async function insertSignal(pool: Pool, signal: Signal, extras: SignalExtras): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO market_signals
      (symbol, timeframe, signal_type, severity, confidence, timestamp, reasons, metrics,
       price, health_score, risk_score, spot_cvd, futures_cvd, open_interest, funding_rate, volume)
     VALUES ($1,$2,$3,$4,$5,to_timestamp($6/1000.0),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING signal_id`,
    [
      signal.symbol,
      signal.timeframe,
      signal.signalType,
      signal.severity,
      signal.confidence,
      signal.timestamp,
      JSON.stringify(signal.reasons),
      JSON.stringify(signal.metrics),
      extras.price,
      extras.healthScore,
      extras.riskScore,
      extras.spotCvd,
      extras.futuresCvd,
      extras.openInterest,
      extras.fundingRate,
      extras.volume,
    ],
  );
  const signalId = rows[0]?.signal_id as string;

  await pool.query(`INSERT INTO signal_outcomes (signal_id, price_at_signal) VALUES ($1, $2)`, [signalId, extras.price]);

  return signalId;
}

export interface LastSignalAlert {
  severity: Signal['severity'];
  confidence: number;
  sentAt: number;
}

/** Most recent alert sent for this exact (symbol, timeframe, signalType) — the alert-cooldown engine's only read (spec §21). */
export async function getLastAlertEvent(
  pool: Pool,
  symbol: string,
  timeframe: string,
  signalType: string,
): Promise<LastSignalAlert | undefined> {
  const { rows } = await pool.query(
    `SELECT severity, confidence, extract(epoch from sent_at)*1000 AS sent_at
     FROM alert_events
     WHERE symbol = $1 AND timeframe = $2 AND signal_type = $3
     ORDER BY sent_at DESC LIMIT 1`,
    [symbol, timeframe, signalType],
  );
  const row = rows[0];
  if (!row) return undefined;
  return { severity: row.severity, confidence: Number(row.confidence), sentAt: Number(row.sent_at) };
}

export async function insertAlertEvent(
  pool: Pool,
  signalId: string,
  signal: Signal,
  chatId: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO alert_events (signal_id, symbol, timeframe, signal_type, severity, confidence, chat_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [signalId, signal.symbol, signal.timeframe, signal.signalType, signal.severity, signal.confidence, chatId],
  );
}

export interface RecentSignalRow extends StoredSignal {
  createdAt: number;
}

export async function getRecentSignals(
  pool: Pool,
  filters: { symbol?: string; timeframe?: string; signalType?: string; limit?: number } = {},
): Promise<RecentSignalRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.symbol) {
    params.push(filters.symbol);
    conditions.push(`symbol = $${params.length}`);
  }
  if (filters.timeframe) {
    params.push(filters.timeframe);
    conditions.push(`timeframe = $${params.length}`);
  }
  if (filters.signalType) {
    params.push(filters.signalType);
    conditions.push(`signal_type = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(filters.limit ?? 50);

  const { rows } = await pool.query(
    `SELECT signal_id, symbol, timeframe, signal_type, severity, confidence, reasons, metrics,
            price, health_score, risk_score, spot_cvd, futures_cvd, open_interest, funding_rate, volume,
            extract(epoch from timestamp)*1000 AS ts, extract(epoch from created_at)*1000 AS created_at
     FROM market_signals
     ${where}
     ORDER BY timestamp DESC
     LIMIT $${params.length}`,
    params,
  );

  return rows.map((r) => ({
    signalId: r.signal_id,
    symbol: r.symbol,
    timeframe: r.timeframe,
    signalType: r.signal_type,
    severity: r.severity,
    confidence: Number(r.confidence),
    timestamp: Number(r.ts),
    reasons: r.reasons,
    metrics: r.metrics,
    price: Number(r.price),
    healthScore: r.health_score,
    riskScore: r.risk_score,
    spotCvd: Number(r.spot_cvd),
    futuresCvd: Number(r.futures_cvd),
    openInterest: Number(r.open_interest),
    fundingRate: Number(r.funding_rate),
    volume: Number(r.volume),
    createdAt: Number(r.created_at),
  }));
}
