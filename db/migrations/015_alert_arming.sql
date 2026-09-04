-- Whether the worker can actually send a health alert.
--
-- The health alerter is opt-in: with TELEGRAM_ALERT_CHAT_IDS unset,
-- runHealthAlertCycle returns on its first line, every fifteen minutes,
-- forever, saying nothing. From outside, "monitoring is switched off" and
-- "nothing has gone wrong" produce identical evidence — silence — and the
-- operator reads the silence as health. That is the exact failure this
-- project spends its effort avoiding, built into the thing whose job was
-- to prevent it.
--
-- So the worker publishes how many chats it could alert, alongside the
-- heartbeat that already says whether it is alive at all. Zero is not an
-- error; it is a fact the status page must be able to state out loud.

ALTER TABLE worker_runtime
  ADD COLUMN IF NOT EXISTS alert_chat_count INTEGER NOT NULL DEFAULT 0;
