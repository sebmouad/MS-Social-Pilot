-- News and blog feeds can have each post's caption written by AI (2026-11-15). Off by default; the message template
-- stays the fallback when AI is off, over budget or fails. Idempotent.
ALTER TABLE feed_sources ADD COLUMN IF NOT EXISTS "aiCaptions" BOOLEAN NOT NULL DEFAULT false;
