-- Which exchange a coin-scan day was read from. Binance refuses the
-- production server's shared IP for hours at a time, and the scan then
-- reads the whole day from OKX instead. The two venues' taker flow differs
-- (opposite signs on BNB and TRX in the same week), so a later judgement
-- of the labels must be able to tell the days apart. Existing rows were
-- all read from Binance.
ALTER TABLE coin_scan_rows ADD COLUMN IF NOT EXISTS exchange TEXT NOT NULL DEFAULT 'binance'
  CHECK (exchange IN ('binance', 'okx'));
