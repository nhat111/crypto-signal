-- Manual trading journal — a free-form log of trades the user actually
-- took, independent of both the market-health signal engine and the gem
-- scanner. Neither of those systems knows what a person actually did with
-- their money; this table is where that gets recorded by hand.

CREATE TABLE trade_journal (
  id BIGSERIAL PRIMARY KEY,
  -- Who logged it. Telegram chat id when entered via the bot; a fixed
  -- sentinel ('web') when entered directly on the web form — the web
  -- dashboard has no login system, so there is no other identity to use.
  chat_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long', 'short')),

  entry_price DOUBLE PRECISION NOT NULL,
  -- Null while the position is still open.
  exit_price DOUBLE PRECISION,
  -- Position size in units of the asset (e.g. 0.1 for 0.1 BTC), not USD
  -- notional — optional, since not every entry needs $ P&L, only %.
  size DOUBLE PRECISION,

  -- Both derived from entry/exit/side/size and stored (not recomputed on
  -- every read) so a later edit to the calc logic can't silently reprice
  -- history — same reasoning as gem_watches' threshold snapshot.
  pnl_pct DOUBLE PRECISION,
  pnl_usd DOUBLE PRECISION,

  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  note TEXT,

  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX idx_trade_journal_chat ON trade_journal (chat_id, opened_at DESC);
CREATE INDEX idx_trade_journal_status ON trade_journal (status);
-- Resolves "/close SYMBOL" to the right row: the most recently opened,
-- still-open position for that chat+symbol.
CREATE INDEX idx_trade_journal_open_lookup ON trade_journal (chat_id, symbol, opened_at DESC) WHERE status = 'open';
