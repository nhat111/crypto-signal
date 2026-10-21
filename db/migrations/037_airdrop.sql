-- Airdrop research (ASSUMPTIONS.md §25).
--
-- airdrop_candidates: one row per tokenless protocol per UTC day, as the
-- worker screened it from DefiLlama. Kept 120 days; the 30-day TVL change
-- is read from these rows, since DefiLlama's list only carries 1d and 7d.
CREATE TABLE IF NOT EXISTS airdrop_candidates (
  day DATE NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  chains TEXT[] NOT NULL DEFAULT '{}',
  tvl_usd DOUBLE PRECISION NOT NULL,
  change_1d_pct DOUBLE PRECISION,
  change_7d_pct DOUBLE PRECISION,
  change_30d_pct DOUBLE PRECISION,
  url TEXT,
  twitter TEXT,
  logo TEXT,
  listed_at TIMESTAMPTZ,
  audits INTEGER,
  parent_slug TEXT,
  reasons JSONB NOT NULL DEFAULT '[]',
  unknowns JSONB NOT NULL DEFAULT '[]',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, slug)
);

CREATE INDEX IF NOT EXISTS airdrop_candidates_slug_day ON airdrop_candidates (slug, day DESC);

-- airdrop_farms: a project a person is farming, logged by hand (web or
-- /farm on the bot). `project_key` is the lowercased name, so "/farm
-- Symbiotic" and the web button on the Symbiotic card land on one farm.
-- `wallet` is a label ("ví 2"), never an address or a key.
CREATE TABLE IF NOT EXISTS airdrop_farms (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL,
  project_key TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'claimed', 'dropped')),
  wallet TEXT,
  note TEXT,
  reward_usd DOUBLE PRECISION CHECK (reward_usd IS NULL OR reward_usd >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

-- One active farm per project per chat; a finished one can be started again.
CREATE UNIQUE INDEX IF NOT EXISTS airdrop_farms_active_project
  ON airdrop_farms (chat_id, project_key) WHERE status = 'active';

-- Each on-chain interaction and what it cost (gas, fees, bridge spread).
CREATE TABLE IF NOT EXISTS airdrop_farm_actions (
  id BIGSERIAL PRIMARY KEY,
  farm_id BIGINT NOT NULL REFERENCES airdrop_farms(id) ON DELETE CASCADE,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  note TEXT
);

CREATE INDEX IF NOT EXISTS airdrop_farm_actions_farm ON airdrop_farm_actions (farm_id, at);
