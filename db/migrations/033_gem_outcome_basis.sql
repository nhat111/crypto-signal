-- How each gem outcome was arrived at, per horizon.
--
-- Until now a token whose pool had vanished was left unpriced forever, and
-- a token whose pool had been drained still counted at whatever price the
-- last quote showed. Both flatter whichever side rugs more: a rug is the
-- most common bad outcome on a small-cap DEX, and it was the one outcome
-- the hit rate could not see. Leaving both sides pending is only fair if
-- the scanner's picks and the rejected controls rug at the same rate,
-- which is the very thing being measured.
--
-- So an outcome is now one of:
--   observed            a quote with liquidity still there; move is real.
--   pool_gone           no pair a full day past the horizon; written off
--                       at -100% (price 0), since there is nothing left to
--                       sell into.
--   liquidity_collapsed liquidity under a fifth of what it was at scan (the
--                       same line /gems already calls "rug-ish"); written
--                       off at -100%. The quote is kept in price_after_* so
--                       the observed move stays recoverable.
-- NULL on a priced row means it was recorded before this column existed.
ALTER TABLE gem_outcomes
  ADD COLUMN IF NOT EXISTS outcome_basis_24h TEXT
    CHECK (outcome_basis_24h IN ('observed', 'pool_gone', 'liquidity_collapsed')),
  ADD COLUMN IF NOT EXISTS outcome_basis_7d TEXT
    CHECK (outcome_basis_7d IN ('observed', 'pool_gone', 'liquidity_collapsed'));

ALTER TABLE gem_baseline_candidates
  ADD COLUMN IF NOT EXISTS outcome_basis_24h TEXT
    CHECK (outcome_basis_24h IN ('observed', 'pool_gone', 'liquidity_collapsed')),
  ADD COLUMN IF NOT EXISTS outcome_basis_7d TEXT
    CHECK (outcome_basis_7d IN ('observed', 'pool_gone', 'liquidity_collapsed'));

-- Apply the collapse rule to 7d rows already recorded: their liquidity was
-- stored, so the rule can be applied exactly. 24h liquidity was never
-- stored, so older 24h rows stay as they were.
UPDATE gem_outcomes
SET move_after_7d_pct = -100, outcome_basis_7d = 'liquidity_collapsed', updated_at = now()
WHERE move_after_7d_pct IS NOT NULL
  AND outcome_basis_7d IS NULL
  AND liquidity_at_scan_usd > 0
  AND liquidity_after_7d_usd < liquidity_at_scan_usd * 0.2;

UPDATE gem_baseline_candidates
SET move_after_7d_pct = -100, outcome_basis_7d = 'liquidity_collapsed', updated_at = now()
WHERE move_after_7d_pct IS NOT NULL
  AND outcome_basis_7d IS NULL
  AND liquidity_usd > 0
  AND liquidity_after_7d_usd < liquidity_usd * 0.2;
