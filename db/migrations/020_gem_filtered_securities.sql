-- What the tokenized-security filter removed on the last scan of each chain.
--
-- The filter drops wrapped equities and ETFs before scoring, because the
-- gem model measures nothing meaningful about them (see
-- gem-scanner/src/tokenizedSecurity.ts). Its failure mode is the one that
-- cannot be noticed from the outside: a rule slightly too broad deletes a
-- real candidate, the list simply gets shorter, and nothing says why.
--
-- So the names are kept, not just a count. Reading "GLD, SPCX, TSLA" is a
-- filter working; reading a memecoin's name there is the bug, and it is
-- the only way that bug ever surfaces.
--
-- Last scan only, deliberately: this is a spot check on a phone, not an
-- audit log, and the alternative is an unbounded table nobody prunes.
ALTER TABLE gem_chain_health
  ADD COLUMN IF NOT EXISTS securities_filtered INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS securities_sample JSONB NOT NULL DEFAULT '[]'::jsonb;
