-- Records whether a background job's last run worked.
--
-- Motivation: /api/flow returns stablecoin: null both when the worker has
-- simply not refreshed yet and when every refresh for the last month has
-- thrown. The UI renders the same "no data yet" for both, so a genuinely
-- broken upstream reads as a normal early state and nobody ever finds out.
--
-- The DefiLlama adapter is the sharpest case: its response shape was never
-- verifiable from the build environment, so a wrong field name is a real
-- possibility and would fail exactly this quietly. But the shape of the
-- problem is generic — a job that fails silently is worse than one that
-- fails loudly — so the table is keyed by job name rather than being
-- specific to this one caller.
--
-- consecutive_failures rather than a boolean: one failed fetch is noise
-- (upstream hiccup, a timeout), fifty in a row is a bug, and the two should
-- not look the same.

CREATE TABLE job_health (
  job_name TEXT PRIMARY KEY,
  last_attempt_at TIMESTAMPTZ,
  -- NULL means the job has never once succeeded. That is a different and
  -- much worse state than "succeeded a while ago", and the difference is
  -- the whole point of this table.
  last_success_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
