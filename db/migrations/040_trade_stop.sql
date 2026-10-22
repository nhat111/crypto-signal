-- A stop (cut-loss price) per journal trade, so a result can be read in R
-- (multiples of what the trade risked) and the size it was opened with can
-- be checked against the chat's /risk rule.
--
-- r_multiple is stored at close beside pnl_pct, for the same reason: a
-- later change to the maths must not reprice history. Both nullable and
-- never backfilled: a stop nobody wrote down at entry cannot be recovered,
-- and guessing one would invent the very discipline being measured.
ALTER TABLE trade_journal ADD COLUMN IF NOT EXISTS stop_price DOUBLE PRECISION;
ALTER TABLE trade_journal ADD COLUMN IF NOT EXISTS r_multiple DOUBLE PRECISION;
