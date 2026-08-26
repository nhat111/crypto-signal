-- Total stablecoin circulating supply, one row per UTC day, as a proxy for
-- money entering or leaving crypto as a whole.
--
-- Stored raw (just the daily figure) rather than pre-aggregated: the 7d/30d
-- change is computed on read by computeStablecoinFlow, the same way the
-- Bollinger reference range is derived from stored candles. That keeps the
-- window definitions changeable without a backfill.
--
-- Deliberately not joined to symbols or timeframes — this is macro context
-- on a daily cadence, and nothing in the candle pipeline or the Health
-- Score reads it (ASSUMPTIONS.md §17).

CREATE TABLE stablecoin_supply (
  day DATE PRIMARY KEY,
  total_circulating_usd DOUBLE PRECISION NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The read path only ever wants the most recent stretch of days.
CREATE INDEX idx_stablecoin_supply_recent ON stablecoin_supply (day DESC);
