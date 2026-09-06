-- Spot as its own side, alongside long and short.
--
-- A spot buy is directionally a long and prices identically, so this is
-- not a new calculation — it is a truthful record. Asking somebody who
-- only ever buys spot to answer "long or short?" makes them answer a
-- futures question about a trade that has no short, and the row then
-- claims a position type they never took. The journal's whole purpose is
-- being what actually happened rather than what the engine assumed.
--
-- Existing rows keep 'long'. Nothing is rewritten: a long logged before
-- this migration may well have been a spot buy, but guessing which would
-- invent history, and the journal is the one place in this system that is
-- only ever what the user typed.
ALTER TABLE trade_journal DROP CONSTRAINT IF EXISTS trade_journal_side_check;
ALTER TABLE trade_journal ADD CONSTRAINT trade_journal_side_check
  CHECK (side IN ('long', 'short', 'spot'));
