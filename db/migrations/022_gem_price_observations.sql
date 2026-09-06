-- Keep watching a token after it stops qualifying.
--
-- Until now the scanner only ever recorded tokens that passed the gate on
-- the scan that saw them. A token that was surfaced and then fell — below
-- the liquidity floor, out of the discovery feeds — simply stopped being
-- observed. Its 24h and 7d outcomes were still priced, but nothing after
-- that existed, and no observation was ever made of what happened next.
--
-- That is survivorship bias inside our own data, and it is not neutral:
-- the population it deletes is exactly the one worth studying. "A token
-- dumps 60-95% and then recovers" is a claim we could not check, because
-- the dump is the moment we looked away. Any future question of that shape
-- needs the observations to already exist — they cannot be backfilled.
--
-- One row per token per scan, eligible or not. `eligible` is what makes it
-- answerable: it separates "we were still watching and it qualified" from
-- "we were still watching and it did not", which a gap in the data cannot.
CREATE TABLE gem_price_observations (
  id BIGSERIAL PRIMARY KEY,
  chain_id TEXT NOT NULL,
  token_address TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,

  -- Never null: an observation with no price is not an observation. A
  -- token whose pool is gone is simply absent for that scan, which is a
  -- different (and honest) fact from a price of zero.
  price_usd DOUBLE PRECISION NOT NULL,
  liquidity_usd DOUBLE PRECISION,
  volume_24h_usd DOUBLE PRECISION,

  -- Whether it would pass the eligibility gate at this observation.
  eligible BOOLEAN NOT NULL,

  -- Idempotent: a scan cycle that retries must not double-record a price.
  UNIQUE (chain_id, token_address, observed_at)
);

CREATE INDEX idx_gem_price_obs_token ON gem_price_observations (chain_id, token_address, observed_at DESC);
CREATE INDEX idx_gem_price_obs_time ON gem_price_observations (observed_at);

-- How many tokens the last scan re-priced beyond the ones it surfaced.
-- On /status this is the difference between "the watchlist is working" and
-- "it silently stopped", which is otherwise invisible until somebody runs
-- a query months later and finds a hole.
ALTER TABLE gem_chain_health
  ADD COLUMN IF NOT EXISTS tracked_observed INTEGER NOT NULL DEFAULT 0;
