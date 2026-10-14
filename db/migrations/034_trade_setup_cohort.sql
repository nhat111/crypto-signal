-- Which group of coins a 4H setup was found in, so the setups can answer
-- whether picking strong coins first is worth anything.
--
-- - core: the tracked symbols (BTC/ETH/SOL), as before.
-- - watchlist: a coin from the daily scan that was on the watchlist (beats
--   BTC over 30 days, still gaining on it, no selling flow) that day. These
--   are the ones alerted.
-- - scan: every other scanned coin. Never alerted; it is the baseline the
--   watchlist is judged against, found by the same detector on the same days.
--
-- `context` keeps what put the coin in its group at detection (scan day,
-- relative strength, flow label), because tomorrow's scan may say otherwise.
-- Existing rows were all core.
ALTER TABLE trade_setups ADD COLUMN IF NOT EXISTS cohort TEXT NOT NULL DEFAULT 'core'
  CHECK (cohort IN ('core', 'watchlist', 'scan'));
ALTER TABLE trade_setups ADD COLUMN IF NOT EXISTS context JSONB;
