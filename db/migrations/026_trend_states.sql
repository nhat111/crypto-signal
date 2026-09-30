-- The daily market-structure read per symbol (up / down / sideways, and
-- whether the last close broke it), plus a ledger of morning digests.
--
-- One row per symbol, overwritten on each read. `previous_trend` is kept on
-- the row so "the label changed on this close" is answerable without a
-- history table: the digest and the web both need exactly that one bit.
CREATE TABLE IF NOT EXISTS trend_states (
  symbol TEXT PRIMARY KEY,
  -- Open time of the last CLOSED daily bar the read used. A read on the
  -- same bar again is not a new close and must not re-announce anything.
  last_close_time TIMESTAMPTZ NOT NULL,
  last_close DOUBLE PRECISION NOT NULL,
  trend TEXT NOT NULL CHECK (trend IN ('up', 'down', 'sideways')),
  event TEXT CHECK (event IN ('up_broken', 'down_broken')),
  previous_trend TEXT CHECK (previous_trend IN ('up', 'down', 'sideways')),
  -- When the label last changed; null until it has changed once.
  changed_at TIMESTAMPTZ,
  ema DOUBLE PRECISION,
  ema_period INTEGER NOT NULL,
  above_ema BOOLEAN,
  swing_highs JSONB NOT NULL,
  swing_lows JSONB NOT NULL,
  reasons JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One morning digest per UTC day, however many times the worker restarts.
-- The insert is the claim: whoever inserts the day sends it.
CREATE TABLE IF NOT EXISTS daily_digests (
  day DATE PRIMARY KEY,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recipients INTEGER NOT NULL DEFAULT 0
);
