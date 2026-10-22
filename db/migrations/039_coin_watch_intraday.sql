-- The intraday exit check (ASSUMPTIONS §22) runs every hour. Each finding
-- is claimed here before it is sent, so a coin reports the same kind of
-- change at most once per UTC day, and a worker restart mid-day does not
-- send it again.
CREATE TABLE IF NOT EXISTS coin_watch_intraday_sent (
  day DATE NOT NULL,
  symbol TEXT NOT NULL,
  kind TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, symbol, kind)
);
