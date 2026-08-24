-- bot_settings.symbols was seeded with a hard-coded BTC/ETH/SOL list, so a
-- chat created before a new symbol was tracked would silently never receive
-- that symbol's alerts — including every futures-only symbol added via
-- FUTURES_ONLY_SYMBOLS.
--
-- An empty array now means "every tracked symbol" (see the subscriber
-- filter in apps/worker/src/pipeline.ts), which keeps the door open for a
-- future per-chat symbol filter without baking today's symbol list into the
-- schema. Existing rows still holding exactly the old default are migrated
-- to that meaning; a row someone has actually customized is left alone.

ALTER TABLE bot_settings ALTER COLUMN symbols SET DEFAULT ARRAY[]::TEXT[];

UPDATE bot_settings
SET symbols = ARRAY[]::TEXT[]
WHERE symbols @> ARRAY['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
  AND symbols <@ ARRAY['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
