-- The autopilot's memory of each Page (2026-11-18): what that Page's own posts taught it (content, time, caption,
-- from reach, reactions, comments and shares), updated on every planning run with newly settled posts. Idempotent.
CREATE TABLE IF NOT EXISTS autopilot_memory (
  "sourceId" TEXT NOT NULL REFERENCES wordpress_recipe_sources(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "targetId" TEXT NOT NULL REFERENCES targets(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE,
  memory JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(memory) = 'object'),
  "learnedThrough" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("sourceId", "targetId")
);
DROP TRIGGER IF EXISTS workspace_purge_write_gate ON autopilot_memory;
CREATE TRIGGER workspace_purge_write_gate BEFORE INSERT OR UPDATE ON autopilot_memory FOR EACH ROW EXECUTE FUNCTION reject_purging_workspace_write();
-- What the AI sees in each recipe photo (2026-11-18): visual traits from a fixed list, learned per Page with the rest.
ALTER TABLE recipe_ratings ADD COLUMN IF NOT EXISTS "photoTraits" TEXT[];
