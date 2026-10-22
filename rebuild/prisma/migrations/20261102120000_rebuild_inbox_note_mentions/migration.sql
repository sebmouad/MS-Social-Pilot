-- Inbox private-note @mentions: store the resolved member ids on the note so delivery can re-verify them.
ALTER TABLE inbox_notes ADD COLUMN IF NOT EXISTS "mentionIds" TEXT[] NOT NULL DEFAULT '{}';
