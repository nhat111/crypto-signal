-- Which exchange's bars found a 4H setup. Binance refuses the production
-- server's shared IP for hours at a time, and the setup scan then reads
-- OKX instead of skipping (it skipped for three days straight before
-- this). A setup is resolved only with bars from the exchange that found
-- it, so a stop or target is never judged on another venue's wicks.
-- Existing rows were all found on Binance.
ALTER TABLE trade_setups ADD COLUMN IF NOT EXISTS exchange TEXT NOT NULL DEFAULT 'binance'
  CHECK (exchange IN ('binance', 'okx'));
