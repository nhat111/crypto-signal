/**
 * Where a stored row came from.
 *
 * 'live'     — the collector observed it as it happened. Carries everything,
 *              including liquidation events, which have no REST history and
 *              exist only from the moment the websocket connected.
 * 'backfill' — reconstructed later by replaying the signal engine over
 *              historical market data. Same maths, strictly less input.
 *
 * The distinction is load-bearing, not bookkeeping: /performance reports the
 * two separately because a replayed signal is weaker evidence than an
 * observed one, and averaging them together would quietly launder that.
 */
export type DataSource = 'live' | 'backfill';

export const DATA_SOURCES: readonly DataSource[] = ['live', 'backfill'];

export function isDataSource(value: string): value is DataSource {
  return (DATA_SOURCES as readonly string[]).includes(value);
}

/**
 * Guard for every `ON CONFLICT ... DO UPDATE` that writes a sourced row.
 *
 * Live data is authoritative and must never be overwritten by a replay:
 * re-running the backfill over a window the collector already observed
 * would otherwise erase real liquidation figures and replace them with
 * NULL. Expressed in SQL rather than in each caller, so no call site can
 * forget it.
 *
 * `table` is the target table name, interpolated directly — callers pass a
 * literal, never user input.
 */
export function keepLiveOverBackfill(table: string): string {
  return `WHERE ${table}.source <> 'live' OR EXCLUDED.source = 'live'`;
}
