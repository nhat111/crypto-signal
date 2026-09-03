-- What the recorded outcomes have actually concluded about each signal
-- type, cached where the rest of the system can read it cheaply.
--
-- The conclusion already existed: /performance compares each type's hit
-- rate against the baseline and says, with a confidence interval, whether
-- it beats doing nothing. But it said so only on that page. The dashboard
-- and the Telegram alert — the two places where somebody is actually
-- deciding something — presented every type identically, including the one
-- the evidence says is reliably *worse* than not trading at all. The
-- system was measuring and not learning.
--
-- Cached rather than computed on demand because the baseline is a lateral
-- join across every 5m candle in the window: fine once an hour, far too
-- heavy to run per alert or per dashboard poll.
--
-- One row per (signal_type, horizon, source), overwritten in place. No
-- history: a verdict that changed is not evidence about the market, it is
-- evidence that more samples arrived, and `sample_count` already says that.

CREATE TABLE IF NOT EXISTS signal_verdicts (
  signal_type TEXT NOT NULL,
  horizon TEXT NOT NULL,
  -- 'live' | 'backfill' | 'all'. Stored as text, not an enum, so adding a
  -- provenance cannot fail an insert in production.
  source TEXT NOT NULL,
  -- 'beats' | 'worse' | 'indistinguishable'. Never null: a type with too
  -- few samples is simply absent from this table, which is a different
  -- statement from "we compared it and could not tell".
  verdict TEXT NOT NULL,
  delta_pp DOUBLE PRECISION NOT NULL,
  margin_pp DOUBLE PRECISION,
  sample_count INTEGER NOT NULL,
  hit_pct DOUBLE PRECISION NOT NULL,
  baseline_pct DOUBLE PRECISION NOT NULL,
  baseline_sample_count INTEGER NOT NULL,
  -- How many types were judged together when this verdict was reached. The
  -- confidence interval depends on it, so storing it is what makes the
  -- number reproducible later.
  comparisons INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (signal_type, horizon, source)
);
