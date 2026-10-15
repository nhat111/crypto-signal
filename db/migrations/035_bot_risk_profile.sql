-- The reader's own account size and risk per trade, so a setup alert can
-- print the position that loses a fixed share of *their* account at the
-- stop, instead of the round 1,000$ / 1% example it used to show.
--
-- account_usd is null until the chat sets it with /risk: an unset account
-- keeps the example rather than guessing one. risk_pct is bounded at 5%,
-- the same refusal /risk and the API make (packages/shared/src/sizing.ts):
-- five stops in a row at more than that cost over a quarter of the account.
ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS account_usd DOUBLE PRECISION
  CHECK (account_usd IS NULL OR account_usd > 0);
ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS risk_pct DOUBLE PRECISION NOT NULL DEFAULT 1
  CHECK (risk_pct > 0 AND risk_pct <= 5);
