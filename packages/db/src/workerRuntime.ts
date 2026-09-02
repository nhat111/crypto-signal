import type { Pool } from 'pg';

/**
 * The worker's live state, published to the database because it has no
 * HTTP surface to be asked.
 *
 * `ctx.connectionStatus` already tracks each Binance socket, but only in
 * memory, where it feeds the data-quality score and nothing else can see
 * it. That left one question unanswerable from outside: when a symbol
 * stops producing snapshots, is the socket dead, or is it open and the
 * pipeline behind it failing? Those have completely different fixes, and
 * guessing wrong costs a day.
 */
export interface WorkerRuntime {
  service: string;
  lastHeartbeatAt: number;
  /** Age at read time. The number that says whether the rest of this row can be trusted. */
  ageMs: number;
  connections: {
    spot: string;
    futures: string;
    liquidation: string;
  };
  /**
   * Epoch millis of the last candle *received* per symbol, stamped in the
   * websocket handler before any processing.
   *
   * Read against the collector's last-snapshot time, this separates the two
   * failures that otherwise look the same: a recent candle with a stale
   * snapshot puts the fault in the pipeline, no candle at all puts it
   * upstream of us.
   */
  symbolIngest: Record<string, number>;
}

export const RUNTIME_WORKER = 'worker';

/**
 * How often the worker republishes. Deliberately not every few seconds:
 * this row exists to answer "is the socket alive", a question whose answer
 * does not change minute to minute, and every write is a write on a small
 * shared Postgres that runs for the life of the service.
 */
export const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Older than this and the row describes a process that may no longer
 * exist, so its connection states must not be read as current. Three
 * missed beats rather than one: a GC pause, a brief database blip or a
 * slow query should not be reported as a dead worker.
 */
export const HEARTBEAT_STALE_MS = 3 * HEARTBEAT_INTERVAL_MS;

export async function recordWorkerHeartbeat(
  pool: Pool,
  service: string,
  connections: { spot: string; futures: string; liquidation: string },
  symbolIngest: Record<string, number> = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO worker_runtime (service, last_heartbeat_at, spot_ws, futures_ws, liquidation_ws, symbol_ingest, updated_at)
     VALUES ($1, now(), $2, $3, $4, $5::jsonb, now())
     ON CONFLICT (service) DO UPDATE SET
       last_heartbeat_at = now(),
       spot_ws = EXCLUDED.spot_ws,
       futures_ws = EXCLUDED.futures_ws,
       liquidation_ws = EXCLUDED.liquidation_ws,
       symbol_ingest = EXCLUDED.symbol_ingest,
       updated_at = now()`,
    [service, connections.spot, connections.futures, connections.liquidation, JSON.stringify(symbolIngest)],
  );
}

/** Null when the worker has never reported — a cold start, not a failure. */
export async function getWorkerRuntime(
  pool: Pool,
  service: string = RUNTIME_WORKER,
  nowMs: number = Date.now(),
): Promise<WorkerRuntime | null> {
  const { rows } = await pool.query(
    `SELECT service, extract(epoch from last_heartbeat_at)*1000 AS beat_ms,
            spot_ws, futures_ws, liquidation_ws, symbol_ingest
     FROM worker_runtime WHERE service = $1`,
    [service],
  );
  const row = rows[0];
  if (!row) return null;

  const lastHeartbeatAt = Math.round(Number(row.beat_ms));
  return {
    service: String(row.service),
    lastHeartbeatAt,
    ageMs: nowMs - lastHeartbeatAt,
    connections: {
      spot: String(row.spot_ws),
      futures: String(row.futures_ws),
      liquidation: String(row.liquidation_ws),
    },
    symbolIngest: (row.symbol_ingest ?? {}) as Record<string, number>,
  };
}
