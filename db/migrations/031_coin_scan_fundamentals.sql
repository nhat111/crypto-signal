-- DefiLlama fundamentals for each coin in a scanned day: the chain and/or
-- protocol the coin matched, fees / TVL / stablecoin changes, and the
-- bull and bear drivers read from them. JSONB because it is read whole
-- and its shape is owned by packages/indicators (CoinFundamentals); null
-- for days scanned before this existed or when DefiLlama could not be read.
ALTER TABLE coin_scan_rows ADD COLUMN IF NOT EXISTS fundamentals JSONB;
