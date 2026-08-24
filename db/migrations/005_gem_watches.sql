-- User-initiated position tracking: "/watch SYMBOL" on the Telegram bot
-- captures the current price/liquidity/risk as an entry snapshot, and a
-- dedicated worker job periodically re-checks it against sell-trigger
-- thresholds. Deliberately separate from gem_scans (the scanner's own
-- unprompted discovery record) — a watch is one chat's position, not a
-- global candidate.

CREATE TABLE gem_watches (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  token_address TEXT NOT NULL,
  symbol TEXT NOT NULL,

  entry_price DOUBLE PRECISION NOT NULL,
  entry_liquidity_usd DOUBLE PRECISION,
  -- Risk/safety at entry, for reference only — the sell check re-reads
  -- whatever the regular scanner most recently observed, never these.
  entry_risk_score INTEGER,
  entry_safety_verdict TEXT,

  -- Snapshotted from GEM_WATCH_* at creation time, so a later env change
  -- never silently alters a watch someone already armed.
  stop_loss_pct DOUBLE PRECISION NOT NULL,
  take_profit_pct DOUBLE PRECISION NOT NULL,
  liquidity_collapse_pct DOUBLE PRECISION NOT NULL,
  risk_score_alert INTEGER NOT NULL,

  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'triggered' | 'closed'
  triggered_reasons JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

-- One active watch per chat+token; re-watching after it closes is fine, so
-- this is a partial index rather than a plain UNIQUE constraint.
CREATE UNIQUE INDEX idx_gem_watches_active ON gem_watches (chat_id, chain_id, token_address) WHERE status = 'active';
CREATE INDEX idx_gem_watches_status ON gem_watches (status) WHERE status = 'active';
