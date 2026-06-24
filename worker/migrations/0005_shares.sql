-- A shareable link to start a copy of a course. subject+angle are snapshotted
-- at mint time; max_uses caps acceptances (a use is claimed atomically).
CREATE TABLE shares (
  token TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  angle TEXT,
  max_uses INTEGER NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- Carries share intent through the magic-link round-trip; NULL for normal sign-ins.
ALTER TABLE magic_tokens ADD COLUMN share_token TEXT;
