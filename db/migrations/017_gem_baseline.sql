-- A control group for the gem scanner.
--
-- /gems reports "14,5% went up, median −21,29%" over the tokens the
-- scanner surfaced. On its own that number cannot answer the only question
-- the money depends on — whether passing the filter beat not bothering —
-- because every row in it passed the same filter. The band comparison
-- already there asks whether the *score* ranks correctly among survivors;
-- it cannot ask whether surviving was worth anything.
--
-- So each scan keeps a bounded random sample of the candidates it
-- REJECTED, and prices them over the same horizons. Only rejections for
-- being the wrong profile qualify (too big, too new, already pumped) —
-- see packages/gem-scanner/src/baseline.ts for why an unreadable or
-- untradeable reject would flatter the scanner rather than test it.
--
-- Candidate and outcome live in one table, unlike gem_scans/gem_outcomes:
-- there is no "did the scanner call this one" question to answer for a
-- control, so there is nothing for a second table to hold.
CREATE TABLE gem_baseline_candidates (
  id BIGSERIAL PRIMARY KEY,
  candidate_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  chain_id TEXT NOT NULL,
  token_address TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,

  -- Which gate reasons it failed, so a later reading can check the control
  -- is not dominated by one kind of reject.
  failures JSONB NOT NULL,

  -- NOT NULL: a candidate with no price cannot be a control, and admitting
  -- one would mean inventing its return later.
  price_usd DOUBLE PRECISION NOT NULL,
  liquidity_usd DOUBLE PRECISION,

  price_after_24h DOUBLE PRECISION,
  price_after_7d DOUBLE PRECISION,
  move_after_24h_pct DOUBLE PRECISION,
  move_after_7d_pct DOUBLE PRECISION,
  liquidity_after_7d_usd DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (chain_id, token_address, observed_at)
);

-- Matches how the tracker reads: oldest unpriced first, per horizon.
CREATE INDEX idx_gem_baseline_pending_24h ON gem_baseline_candidates (observed_at)
  WHERE price_after_24h IS NULL;
CREATE INDEX idx_gem_baseline_pending_7d ON gem_baseline_candidates (observed_at)
  WHERE price_after_7d IS NULL;
