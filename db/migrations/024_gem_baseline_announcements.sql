-- Push the baseline verdict instead of waiting to be asked.
--
-- Whether the scanner beats the tokens it rejected is the question that
-- governs every other decision about it — including whether to keep it on
-- at all. Until now the only way to see the answer was to open /gems and
-- read a card, so the mechanism for learning it was somebody remembering
-- to look. That is not a mechanism.
--
-- This table is what makes the push idempotent across restarts. The worker
-- redeploys often; in-memory "already sent" state would re-announce on
-- every boot, and an alert that repeats itself is one people learn to
-- ignore — which would defeat the point on the single message that matters
-- most.
CREATE TABLE gem_baseline_announcements (
  id BIGSERIAL PRIMARY KEY,
  horizon TEXT NOT NULL,

  -- The verdict as announced. Re-announcing is driven by this CHANGING,
  -- not by time: crossing the threshold is news once, but a later flip
  -- from 'beats' to 'worse' is the most important message the system can
  -- send, and an announce-once rule would swallow it.
  verdict TEXT NOT NULL,

  -- What the verdict was read off, kept so a past announcement can be
  -- audited rather than taken on trust.
  scanner_sample_count INTEGER NOT NULL,
  baseline_sample_count INTEGER NOT NULL,
  delta_pp DOUBLE PRECISION NOT NULL,
  margin_pp DOUBLE PRECISION,

  announced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gem_baseline_announcements_latest
  ON gem_baseline_announcements (horizon, announced_at DESC);
