-- Support futures-only symbols (Binance Futures listing, no Spot listing —
-- e.g. HYPEUSDT). Health Score and Spot CVD are meaningless without a Spot
-- leg to compare against, so these columns become nullable rather than
-- storing a fabricated 0 (ASSUMPTIONS.md §15). Risk Score stays NOT NULL —
-- it never depended on Spot data.

ALTER TABLE market_signals
  ALTER COLUMN health_score DROP NOT NULL,
  ALTER COLUMN spot_cvd DROP NOT NULL;

ALTER TABLE market_health_snapshots
  ALTER COLUMN health_score DROP NOT NULL,
  ALTER COLUMN health_status DROP NOT NULL,
  ALTER COLUMN health_components DROP NOT NULL;
