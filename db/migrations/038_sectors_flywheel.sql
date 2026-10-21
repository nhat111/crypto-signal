-- Sector read and flywheel list (ASSUMPTIONS.md §26). Both are one row per
-- item per UTC day, kept 120 days, so a label or a payout can later be
-- compared with what it was.

CREATE TABLE IF NOT EXISTS sector_days (
  day DATE NOT NULL,
  category_id TEXT NOT NULL,
  name TEXT NOT NULL,
  coin_count INTEGER NOT NULL,
  median_7d_pct DOUBLE PRECISION NOT NULL,
  median_30d_pct DOUBLE PRECISION NOT NULL,
  rs_7d DOUBLE PRECISION NOT NULL,
  rs_30d DOUBLE PRECISION NOT NULL,
  breadth_7d_pct DOUBLE PRECISION NOT NULL,
  breadth_30d_pct DOUBLE PRECISION NOT NULL,
  weighted_7d_pct DOUBLE PRECISION,
  btc_7d_pct DOUBLE PRECISION NOT NULL,
  btc_30d_pct DOUBLE PRECISION NOT NULL,
  label TEXT NOT NULL CHECK (label IN ('leading', 'emerging', 'fading', 'lagging')),
  leaders JSONB NOT NULL DEFAULT '[]',
  reasons JSONB NOT NULL DEFAULT '[]',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, category_id)
);

CREATE TABLE IF NOT EXISTS flywheel_days (
  day DATE NOT NULL,
  family_key TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT,
  gecko_id TEXT,
  category TEXT,
  holders_revenue_30d_usd DOUBLE PRECISION NOT NULL,
  holders_revenue_prev_30d_usd DOUBLE PRECISION,
  holders_revenue_change_pct DOUBLE PRECISION,
  annualized_usd DOUBLE PRECISION NOT NULL,
  market_cap_usd DOUBLE PRECISION,
  yield_pct DOUBLE PRECISION,
  price_change_30d_pct DOUBLE PRECISION,
  mechanism TEXT,
  sources JSONB NOT NULL DEFAULT '[]',
  reasons JSONB NOT NULL DEFAULT '[]',
  unknowns JSONB NOT NULL DEFAULT '[]',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, family_key)
);
