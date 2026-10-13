-- The wide coin scan (/coins): one row per coin per UTC day, read from
-- REST once a day for the most-traded coins — no WebSocket, no candles
-- stored. Kept as a history rather than overwritten, so the labels and the
-- relative-strength ranking can later be judged against what price did
-- next (the close is on every row), the same way signals are judged.
CREATE TABLE IF NOT EXISTS coin_scan_rows (
  -- Open time of the last CLOSED daily bar, as a date: the day the row describes.
  day DATE NOT NULL,
  symbol TEXT NOT NULL,
  -- By 24h spot quote volume at scan time, 1 = most traded.
  volume_rank INTEGER NOT NULL,
  futures_symbol TEXT,
  close DOUBLE PRECISION NOT NULL,
  spot_quote_volume_24h DOUBLE PRECISION NOT NULL,
  ret_7d DOUBLE PRECISION,
  ret_30d DOUBLE PRECISION,
  rs_7d DOUBLE PRECISION,
  rs_30d DOUBLE PRECISION,
  rs_above_sma20 BOOLEAN,
  down_day_excess DOUBLE PRECISION,
  down_days INTEGER NOT NULL,
  taker_skew_7d DOUBLE PRECISION,
  taker_skew_30d DOUBLE PRECISION,
  oi_change_7d_pct DOUBLE PRECISION,
  funding_avg_7d_pct DOUBLE PRECISION,
  spot_perp_volume_ratio DOUBLE PRECISION,
  flow TEXT NOT NULL,
  reasons JSONB NOT NULL,
  unknowns JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, symbol)
);

CREATE INDEX IF NOT EXISTS coin_scan_rows_symbol_day ON coin_scan_rows (symbol, day);
