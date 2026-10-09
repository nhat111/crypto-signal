-- Entry setups the worker found on closed 4H bars (pullback to the 1D swing
-- low, breakout above the 1D swing high and retest), with the plan priced
-- at detection, and how each one actually ended.
--
-- The outcome is recorded because the setups are a claim: until enough of
-- them have resolved, nobody — including the person reading the alert —
-- knows whether following them beats not following them.
CREATE TABLE IF NOT EXISTS trade_setups (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pullback', 'breakout_retest')),
  -- The 4H bar that completed the setup. With symbol and kind, the dedupe
  -- key: the scan runs hourly and re-reads the same closed bar four times.
  bar_open_time TIMESTAMPTZ NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  level DOUBLE PRECISION NOT NULL,
  entry DOUBLE PRECISION NOT NULL,
  stop DOUBLE PRECISION NOT NULL,
  target DOUBLE PRECISION NOT NULL,
  rr DOUBLE PRECISION NOT NULL,
  atr DOUBLE PRECISION NOT NULL,
  reasons JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'target', 'stop', 'expired')),
  resolved_at TIMESTAMPTZ,
  -- Result in multiples of the planned risk: +rr at target, -1 at stop,
  -- wherever price closed for an expired one.
  r_multiple DOUBLE PRECISION,
  UNIQUE (symbol, kind, bar_open_time)
);

CREATE INDEX IF NOT EXISTS idx_trade_setups_open ON trade_setups (status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_trade_setups_recent ON trade_setups (detected_at DESC);
