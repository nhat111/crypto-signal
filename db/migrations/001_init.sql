-- Market Health Monitor — initial schema.
-- Tables match spec §28's minimum list plus a couple of natural additions
-- (futures_metrics/spot_metrics split, market_health_snapshots) noted in
-- ASSUMPTIONS.md. Retention: aggregated rows only, one row per
-- (symbol, market/side, timeframe, bucket) — no raw tick table (ASSUMPTIONS §13).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE symbols (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  base_asset TEXT NOT NULL,
  quote_asset TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE market_candles (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('spot', 'futures')),
  timeframe TEXT NOT NULL CHECK (timeframe IN ('5m', '15m', '1h', '4h')),
  open_time TIMESTAMPTZ NOT NULL,
  close_time TIMESTAMPTZ NOT NULL,
  open DOUBLE PRECISION NOT NULL,
  high DOUBLE PRECISION NOT NULL,
  low DOUBLE PRECISION NOT NULL,
  close DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION NOT NULL,
  quote_volume DOUBLE PRECISION NOT NULL,
  trades INTEGER NOT NULL,
  taker_buy_base_volume DOUBLE PRECISION NOT NULL,
  taker_buy_quote_volume DOUBLE PRECISION NOT NULL,
  taker_sell_base_volume DOUBLE PRECISION NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol, market, timeframe, open_time)
);
CREATE INDEX idx_market_candles_lookup ON market_candles (symbol, market, timeframe, open_time DESC);

CREATE TABLE spot_metrics (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('5m', '15m', '1h', '4h')),
  timestamp TIMESTAMPTZ NOT NULL,
  cvd_delta DOUBLE PRECISION NOT NULL,
  cvd_skew_ratio DOUBLE PRECISION NOT NULL,
  cvd_cumulative DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION NOT NULL,
  volume_ratio DOUBLE PRECISION NOT NULL,
  volume_anomaly TEXT NOT NULL,
  UNIQUE (symbol, timeframe, timestamp)
);
CREATE INDEX idx_spot_metrics_lookup ON spot_metrics (symbol, timeframe, timestamp DESC);

CREATE TABLE futures_metrics (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('5m', '15m', '1h', '4h')),
  timestamp TIMESTAMPTZ NOT NULL,
  cvd_delta DOUBLE PRECISION NOT NULL,
  cvd_skew_ratio DOUBLE PRECISION NOT NULL,
  cvd_cumulative DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION NOT NULL,
  volume_ratio DOUBLE PRECISION NOT NULL,
  volume_anomaly TEXT NOT NULL,
  open_interest DOUBLE PRECISION NOT NULL,
  oi_change_pct DOUBLE PRECISION NOT NULL,
  oi_velocity_pct_per_hour DOUBLE PRECISION NOT NULL,
  funding_rate DOUBLE PRECISION NOT NULL,
  funding_rate_pct DOUBLE PRECISION NOT NULL,
  basis_absolute DOUBLE PRECISION NOT NULL,
  basis_pct DOUBLE PRECISION NOT NULL,
  liquidation_long_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  liquidation_short_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  liquidation_anomaly_ratio DOUBLE PRECISION NOT NULL DEFAULT 0,
  UNIQUE (symbol, timeframe, timestamp)
);
CREATE INDEX idx_futures_metrics_lookup ON futures_metrics (symbol, timeframe, timestamp DESC);

CREATE TABLE funding_rates (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  funding_time TIMESTAMPTZ NOT NULL,
  funding_rate DOUBLE PRECISION NOT NULL,
  mark_price DOUBLE PRECISION,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol, funding_time)
);

CREATE TABLE open_interest (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('5m', '15m', '1h', '4h')),
  timestamp TIMESTAMPTZ NOT NULL,
  sum_open_interest DOUBLE PRECISION NOT NULL,
  sum_open_interest_value DOUBLE PRECISION NOT NULL,
  UNIQUE (symbol, timeframe, timestamp)
);
CREATE INDEX idx_open_interest_lookup ON open_interest (symbol, timeframe, timestamp DESC);

-- Liquidation events cannot be backfilled (ASSUMPTIONS.md §1/§6) so this
-- table only fills from collector start onward. Individual liquidation
-- orders, not trade ticks — sparse enough to keep raw and prune by age
-- (worker retention job drops rows older than 30 days).
CREATE TABLE liquidations (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  order_type TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  average_price DOUBLE PRECISION NOT NULL,
  quote_quantity DOUBLE PRECISION NOT NULL,
  order_status TEXT NOT NULL,
  order_trade_time TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_liquidations_lookup ON liquidations (symbol, order_trade_time DESC);

-- Health/Risk score + price per (symbol, timeframe, timestamp) — the
-- primary table the dashboard and Telegram bot read for "current state".
CREATE TABLE market_health_snapshots (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('5m', '15m', '1h', '4h')),
  timestamp TIMESTAMPTZ NOT NULL,
  price_close DOUBLE PRECISION NOT NULL,
  price_change_pct DOUBLE PRECISION NOT NULL,
  health_score INTEGER NOT NULL,
  health_status TEXT NOT NULL,
  health_components JSONB NOT NULL,
  risk_score INTEGER NOT NULL,
  risk_components JSONB NOT NULL,
  data_quality_score INTEGER NOT NULL,
  UNIQUE (symbol, timeframe, timestamp)
);
CREATE INDEX idx_health_snapshots_lookup ON market_health_snapshots (symbol, timeframe, timestamp DESC);

CREATE TABLE market_signals (
  id BIGSERIAL PRIMARY KEY,
  signal_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('5m', '15m', '1h', '4h')),
  signal_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'EXTREME')),
  confidence DOUBLE PRECISION NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  reasons JSONB NOT NULL,
  metrics JSONB NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  health_score INTEGER NOT NULL,
  risk_score INTEGER NOT NULL,
  spot_cvd DOUBLE PRECISION NOT NULL,
  futures_cvd DOUBLE PRECISION NOT NULL,
  open_interest DOUBLE PRECISION NOT NULL,
  funding_rate DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_market_signals_lookup ON market_signals (symbol, timeframe, signal_type, timestamp DESC);
CREATE INDEX idx_market_signals_type ON market_signals (signal_type, timestamp DESC);

-- Phase 9 historical validation (spec §23/§24).
CREATE TABLE signal_outcomes (
  id BIGSERIAL PRIMARY KEY,
  signal_id UUID NOT NULL REFERENCES market_signals (signal_id) ON DELETE CASCADE UNIQUE,
  price_at_signal DOUBLE PRECISION NOT NULL,
  price_after_15m DOUBLE PRECISION,
  price_after_1h DOUBLE PRECISION,
  price_after_4h DOUBLE PRECISION,
  price_after_24h DOUBLE PRECISION,
  move_after_15m_pct DOUBLE PRECISION,
  move_after_1h_pct DOUBLE PRECISION,
  move_after_4h_pct DOUBLE PRECISION,
  move_after_24h_pct DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_events (
  id BIGSERIAL PRIMARY KEY,
  signal_id UUID NOT NULL REFERENCES market_signals (signal_id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  chat_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alert_events_cooldown ON alert_events (symbol, timeframe, signal_type, sent_at DESC);

CREATE TABLE bot_users (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL UNIQUE,
  username TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bot_settings (
  chat_id TEXT PRIMARY KEY REFERENCES bot_users (chat_id) ON DELETE CASCADE,
  alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  min_severity TEXT NOT NULL DEFAULT 'MEDIUM',
  -- Superseded by migration 003, which redefines an empty array as "every
  -- tracked symbol". Left as-is here: never edit an applied migration.
  symbols TEXT[] NOT NULL DEFAULT ARRAY['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
