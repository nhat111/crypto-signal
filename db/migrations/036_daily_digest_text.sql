-- The morning digest as it was sent, so /digest can show it again later in
-- the day: a missed message used to be gone for good.
--
-- `body` on daily_digests is the shared part every chat received; it stays
-- null for days sent before this migration, and for a day whose build
-- failed after the claim. daily_digest_chats holds the full message one
-- chat received, with its own "Của bạn" section (open journal trades,
-- open setups sized for its /risk account). A chat that was not a
-- recipient that morning has no row and is shown the shared body.
ALTER TABLE daily_digests ADD COLUMN IF NOT EXISTS body TEXT;

CREATE TABLE IF NOT EXISTS daily_digest_chats (
  day DATE NOT NULL REFERENCES daily_digests(day) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (day, chat_id)
);
