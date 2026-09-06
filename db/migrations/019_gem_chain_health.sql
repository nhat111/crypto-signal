-- Whether each configured gem chain is actually producing anything.
--
-- A wrong chain id and a quiet chain look identical from outside: both
-- report zero candidates, forever, without complaint. That is the same
-- shape of failure as a mistyped ALERT_TIMEFRAMES — silence that reads as
-- "nothing is happening" — and it had already been sitting in production
-- for days on a chain whose GeckoTerminal mapping does not exist.
--
-- A table rather than worker memory, for the reason symbolIngest taught:
-- a scan runs every thirty minutes, so an in-memory record would be empty
-- for half an hour after every deploy — exactly when somebody looks.
CREATE TABLE gem_chain_health (
  chain_id TEXT PRIMARY KEY,
  last_scan_at TIMESTAMPTZ NOT NULL,
  candidate_count INTEGER NOT NULL,
  eligible_count INTEGER NOT NULL,

  -- Per discovery feed: a number, or the string "unsupported" when the
  -- feed does not cover this chain. Stored as written rather than
  -- flattened to a count, because "covered and empty" and "not covered"
  -- need different fixes.
  sources JSONB NOT NULL,

  -- Scans in a row that found nothing. One empty scan is a quiet half
  -- hour; a streak is a configuration that cannot work.
  consecutive_empty_scans INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
