-- Small-cap discovery ("hidden gem") scanner.
--
-- Kept in separate tables from the Binance market-health domain rather than
-- widened into the existing ones: these tokens have no funding, no open
-- interest, and no spot-vs-futures relationship, so sharing a table would
-- mean mostly-NULL columns and a schema that lies about what it holds.

CREATE TABLE gem_tokens (
  id BIGSERIAL PRIMARY KEY,
  chain_id TEXT NOT NULL,
  token_address TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  pair_address TEXT NOT NULL,
  dex_id TEXT NOT NULL,
  dexscreener_url TEXT,
  -- Pool creation time as reported upstream; NULL when not reported, which
  -- blocks age-based scoring rather than being guessed.
  pair_created_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, token_address)
);
CREATE INDEX idx_gem_tokens_chain ON gem_tokens (chain_id, last_seen_at DESC);

-- One row per token per scan pass. This is the historical record the
-- performance surface is computed from — without it the scanner could only
-- ever claim edge, never show it.
CREATE TABLE gem_scans (
  id BIGSERIAL PRIMARY KEY,
  -- UNIQUE inline (not a later ALTER) because the tables below take a
  -- foreign key against it, which Postgres only allows once the column is
  -- already unique.
  scan_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  chain_id TEXT NOT NULL,
  token_address TEXT NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL,

  gem_score INTEGER NOT NULL,
  gem_components JSONB NOT NULL,
  risk_score INTEGER NOT NULL,
  risk_components JSONB NOT NULL,
  reasons JSONB NOT NULL,

  price_usd DOUBLE PRECISION,
  liquidity_usd DOUBLE PRECISION,
  volume_24h_usd DOUBLE PRECISION,
  fdv_usd DOUBLE PRECISION,
  price_change_24h_pct DOUBLE PRECISION,
  buys_24h INTEGER,
  sells_24h INTEGER,
  age_days DOUBLE PRECISION,

  -- 'safe' | 'caution' | 'danger' | 'unknown'. NULL means no screen ran at
  -- all for this chain — distinct from 'unknown', which means a screen was
  -- attempted and could not confirm anything.
  safety_verdict TEXT,
  safety_flags JSONB,
  top_holder_pct DOUBLE PRECISION,
  lp_locked BOOLEAN,

  UNIQUE (chain_id, token_address, scanned_at)
);
CREATE INDEX idx_gem_scans_lookup ON gem_scans (chain_id, scanned_at DESC);
CREATE INDEX idx_gem_scans_token ON gem_scans (chain_id, token_address, scanned_at DESC);
CREATE INDEX idx_gem_scans_score ON gem_scans (scanned_at DESC, gem_score DESC);

-- Forward-looking outcomes, mirroring signal_outcomes on the market-health
-- side: what actually happened after the scanner surfaced a token.
--
-- Rows are created only for scans the scanner actually *called* (score at
-- or above the alert threshold), not for every pass — otherwise the same
-- token rescanned every 30 minutes would flood the sample and the honest
-- question ("when this flagged something, what happened?") would be
-- answered against mostly-duplicate rows.
--
-- Horizons are 24h/7d rather than the market-health side's 15m/1h: a
-- small-cap thesis doesn't resolve in minutes.
CREATE TABLE gem_outcomes (
  id BIGSERIAL PRIMARY KEY,
  scan_id UUID NOT NULL REFERENCES gem_scans (scan_id) ON DELETE CASCADE UNIQUE,
  price_at_scan DOUBLE PRECISION NOT NULL,
  liquidity_at_scan_usd DOUBLE PRECISION,
  price_after_24h DOUBLE PRECISION,
  price_after_7d DOUBLE PRECISION,
  move_after_24h_pct DOUBLE PRECISION,
  move_after_7d_pct DOUBLE PRECISION,
  -- Tracked explicitly because "how often did this scanner point at
  -- something whose liquidity then vanished" is the number that matters
  -- most here, and an average return would hide exactly that.
  liquidity_after_7d_usd DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gem_alert_events (
  id BIGSERIAL PRIMARY KEY,
  scan_id UUID NOT NULL REFERENCES gem_scans (scan_id) ON DELETE CASCADE,
  chain_id TEXT NOT NULL,
  token_address TEXT NOT NULL,
  gem_score INTEGER NOT NULL,
  chat_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_gem_alert_cooldown ON gem_alert_events (chain_id, token_address, sent_at DESC);
