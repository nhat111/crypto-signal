-- BTC's daily trend when a setup was found.
--
-- The detector reads only the coin's own daily structure, so an altcoin
-- pullback is offered while BTC itself is in a downtrend. Whether those
-- setups do worse is a question the record can answer, but only if the
-- trend is written at detection: the stored trend state is overwritten
-- every day, so it cannot be recovered afterwards. Existing rows stay
-- NULL and are left out of the comparison rather than guessed.
ALTER TABLE trade_setups ADD COLUMN IF NOT EXISTS btc_trend TEXT
  CHECK (btc_trend IN ('up', 'down', 'sideways'));
