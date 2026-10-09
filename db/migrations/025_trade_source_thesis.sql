-- Where a trade idea came from, and why it was taken — as two columns,
-- separate from the free-form note.
--
-- They exist to be counted. "Which of the accounts I follow actually makes
-- me money?" can only be answered by grouping closed trades by their
-- source, and a source buried somewhere in a free-text note cannot be
-- grouped. The thesis sits beside it so that a losing trade can be read
-- back against the reason it was opened, not the reason remembered later.
--
-- Both nullable and never backfilled: an old row's note may well name its
-- source, but guessing which words were the source would invent history.
ALTER TABLE trade_journal ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE trade_journal ADD COLUMN IF NOT EXISTS thesis TEXT;
