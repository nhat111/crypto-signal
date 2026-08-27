-- Marks where every row came from, so replayed history and observed history
-- can never be silently mixed.
--
-- Motivation: /performance had 53 recorded outcomes for its largest signal
-- type — far too few to distinguish from chance. The fix is more samples,
-- and the only way to get them quickly is to replay the (already pure)
-- signal engine over historical market data. But a replayed signal is NOT
-- the same evidence as an observed one:
--
--   * Binance serves open-interest history for the last 30 days only, so
--     everything older can never be replayed at all.
--   * Liquidation events have no REST history whatsoever — they exist only
--     from the moment the collector's websocket connected. A replayed
--     candle therefore knows nothing about liquidations, which is not the
--     same as knowing there were none.
--
-- Hence `source`. 'live' means the collector observed it; 'backfill' means
-- it was reconstructed. Defaulting to 'live' is correct for every existing
-- row: they all came from the running collector.

ALTER TABLE market_candles
  ADD COLUMN source TEXT NOT NULL DEFAULT 'live' CHECK (source IN ('live', 'backfill'));

ALTER TABLE spot_metrics
  ADD COLUMN source TEXT NOT NULL DEFAULT 'live' CHECK (source IN ('live', 'backfill'));

ALTER TABLE futures_metrics
  ADD COLUMN source TEXT NOT NULL DEFAULT 'live' CHECK (source IN ('live', 'backfill'));

ALTER TABLE market_health_snapshots
  ADD COLUMN source TEXT NOT NULL DEFAULT 'live' CHECK (source IN ('live', 'backfill'));

ALTER TABLE market_signals
  ADD COLUMN source TEXT NOT NULL DEFAULT 'live' CHECK (source IN ('live', 'backfill'));

-- /performance splits its aggregates by source, and the baseline control
-- has to be measured over the same source as the signals it controls for.
CREATE INDEX idx_market_signals_source ON market_signals (source, signal_type, timestamp DESC);
CREATE INDEX idx_market_candles_source ON market_candles (source, symbol, market, timeframe, open_time DESC);

-- Liquidation figures are unknowable for a replayed candle. They were
-- NOT NULL DEFAULT 0, which would record "we replayed this candle and saw
-- no liquidations" — a claim the data cannot support. Relaxing to NULL
-- keeps the existing live rows exactly as they are (an observed 0 really
-- does mean zero liquidations in that candle) while letting a replayed row
-- say "unknown" instead.
ALTER TABLE futures_metrics
  ALTER COLUMN liquidation_long_usd DROP NOT NULL,
  ALTER COLUMN liquidation_long_usd DROP DEFAULT,
  ALTER COLUMN liquidation_short_usd DROP NOT NULL,
  ALTER COLUMN liquidation_short_usd DROP DEFAULT,
  ALTER COLUMN liquidation_anomaly_ratio DROP NOT NULL,
  ALTER COLUMN liquidation_anomaly_ratio DROP DEFAULT;
