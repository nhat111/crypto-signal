-- Clears recorded signal outcomes so the (now corrected) outcome tracker
-- recomputes them from candle history.
--
-- Until now the tracker recorded whatever the *newest* futures candle was
-- when it happened to run, rather than the candle at signal time + horizon.
-- Those coincide only while the job keeps up; whenever the worker was down
-- or stuck, its backlog was priced at the moment of recovery instead — so
-- an unknown subset of these rows measures the wrong window, and nothing
-- in the data distinguishes a correct row from a wrong one.
--
-- Recomputing is safe rather than destructive: market_candles is never
-- pruned, so every price here is derivable from retained data. For rows
-- that were already recorded promptly the recomputed value is the same
-- (within one 5m candle); for late ones it is a repair. Signals whose
-- candles are genuinely missing stay NULL — unresolved is honest, a number
-- measured over the wrong window is not.
--
-- The tracker refills these on its normal 5-minute cadence (200 rows per
-- horizon per pass), so a large backlog resolves over the following hours
-- with no manual step. /performance will under-report sample counts until
-- it catches up, which is the correct thing for it to do.

UPDATE signal_outcomes SET
  price_after_15m = NULL, move_after_15m_pct = NULL,
  price_after_1h  = NULL, move_after_1h_pct  = NULL,
  price_after_4h  = NULL, move_after_4h_pct  = NULL,
  price_after_24h = NULL, move_after_24h_pct = NULL,
  updated_at = now();
