-- AI auto-replies to comments and Messenger messages (2026-11-17, owner's choices by form): off until switched on;
-- answers only what arrived after it was switched on, once nobody on the team has replied for "delayMinutes".
-- Each action is logged in moderation_actions (ruleId NULL, action ai_reply / ai_handoff / ai_skip); the partial
-- unique index below makes sure one comment or message is never answered twice. Idempotent.
CREATE TABLE IF NOT EXISTS inbox_ai_replies (
  "workspaceId" TEXT PRIMARY KEY REFERENCES workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  comments BOOLEAN NOT NULL DEFAULT true,
  messages BOOLEAN NOT NULL DEFAULT true,
  "delayMinutes" INTEGER NOT NULL DEFAULT 30 CHECK ("delayMinutes" BETWEEN 0 AND 1440),
  "targetIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  tone TEXT NOT NULL DEFAULT 'friendly' CHECK (tone IN ('friendly', 'short', 'expert')),
  "enabledAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedById" TEXT
);
DROP TRIGGER IF EXISTS workspace_purge_write_gate ON inbox_ai_replies;
CREATE TRIGGER workspace_purge_write_gate BEFORE INSERT OR UPDATE ON inbox_ai_replies FOR EACH ROW EXECUTE FUNCTION reject_purging_workspace_write();
CREATE UNIQUE INDEX IF NOT EXISTS moderation_actions_ai_once_key ON moderation_actions ("workspaceId", "targetId", "remoteCommentId")
  WHERE "ruleId" IS NULL AND action IN ('ai_reply', 'ai_handoff', 'ai_skip');
-- What the AI sent (or why it left the item for a person), shown in the Inbox rules log.
ALTER TABLE moderation_actions ADD COLUMN IF NOT EXISTS "replyText" TEXT;
