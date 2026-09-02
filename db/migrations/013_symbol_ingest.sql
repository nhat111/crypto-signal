-- When a symbol goes quiet, two very different things look identical from
-- outside: its candles stopped arriving from Binance, or they arrive and
-- something downstream drops them. The collector card only shows the last
-- *snapshot*, which requires the whole pipeline to succeed, so it cannot
-- tell those apart — and that ambiguity has cost several rounds of
-- guessing on HYPEUSDT.
--
-- This records when a candle was last *received*, stamped in the websocket
-- handler before any processing. Received recently but no snapshot means
-- the fault is in the pipeline; nothing received means it is upstream.
--
-- One JSONB column rather than a table: it is written with the heartbeat,
-- read whole, and never queried by symbol.

ALTER TABLE worker_runtime
  ADD COLUMN IF NOT EXISTS symbol_ingest JSONB NOT NULL DEFAULT '{}'::jsonb;
