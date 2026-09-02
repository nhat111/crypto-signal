-- What the worker is doing right now, not just which build it booted.
--
-- 011 recorded the worker's build at boot because it has no HTTP surface.
-- The same blindness applies to its live state: whether each Binance
-- websocket is actually open lives only in `ctx.connectionStatus`, in
-- memory, where nothing outside the process can read it. When a symbol
-- goes quiet the operator sees a stale snapshot and cannot tell a dead
-- socket from a bug in the pipeline behind it.
--
-- One row per service, overwritten in place: only the current state is
-- interesting, and keeping history here would be a second, worse copy of
-- what the candle and snapshot tables already record.

CREATE TABLE IF NOT EXISTS worker_runtime (
  service TEXT PRIMARY KEY,
  last_heartbeat_at TIMESTAMPTZ NOT NULL,
  -- 'connecting' | 'open' | 'closed' | 'error' — text rather than an enum so
  -- a new state in the adapter cannot fail an insert in production.
  spot_ws TEXT NOT NULL,
  futures_ws TEXT NOT NULL,
  liquidation_ws TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
