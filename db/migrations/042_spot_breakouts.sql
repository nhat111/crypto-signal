-- Spot breakouts on the daily chart (ASSUMPTIONS §27): a close above the
-- 20-day high while BTC is in an uptrend, a fixed stop at the 10-day low and
-- a trailing exit on a close under the prior 10-day low.
--
-- Recorded paper-style, like the 4H setups: the rule replayed positive on
-- 18 months of OKX data but only thanks to the rising part of it, so each
-- live position is written down at detection and followed to its exit to
-- show whether it keeps up outside the replay. One open position per coin,
-- the same as the replay.
CREATE TABLE IF NOT EXISTS spot_breakouts (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL CHECK (exchange IN ('binance', 'okx')),
  -- The daily bar whose close broke out. With symbol, the dedupe key: the
  -- job runs hourly and re-reads the same closed day.
  bar_open_time TIMESTAMPTZ NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  entry DOUBLE PRECISION NOT NULL,
  stop DOUBLE PRECISION NOT NULL,
  high20 DOUBLE PRECISION NOT NULL,
  -- The trailing line as of the last daily close read; only ever raised.
  trail DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'stop', 'trail')),
  exit_price DOUBLE PRECISION,
  exit_time TIMESTAMPTZ,
  return_pct DOUBLE PRECISION,
  r_multiple DOUBLE PRECISION,
  UNIQUE (symbol, bar_open_time)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_spot_breakouts_one_open ON spot_breakouts (symbol) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_spot_breakouts_recent ON spot_breakouts (bar_open_time DESC);

-- One row per daily run: BTC's regime that day and what the run did, so the
-- read-only API can say why the list is empty ("BTC chưa tăng") without
-- asking an exchange.
CREATE TABLE IF NOT EXISTS spot_breakout_runs (
  day DATE PRIMARY KEY,
  regime_up BOOLEAN NOT NULL,
  btc_close DOUBLE PRECISION NOT NULL,
  btc_ema50 DOUBLE PRECISION NOT NULL,
  btc_ema200 DOUBLE PRECISION NOT NULL,
  coins_read INTEGER NOT NULL,
  found INTEGER NOT NULL,
  closed INTEGER NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
