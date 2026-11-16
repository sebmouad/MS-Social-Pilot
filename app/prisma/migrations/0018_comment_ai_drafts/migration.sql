-- Recipe autopilot (2026-11-16): a reply drafted by AI for a comment on a recipe post, shown ready in the Inbox reply
-- box. Nothing is ever sent without a member pressing Send. Idempotent.
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS "aiDraft" TEXT;
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS "aiDraftAt" TIMESTAMP(3);
