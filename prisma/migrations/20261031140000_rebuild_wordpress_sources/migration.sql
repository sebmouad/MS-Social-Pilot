BEGIN;
-- Recipe sources read from a WordPress site (read-only, by the application) and a ledger of what was planned.
-- Direct workspace FKs participate in the catalog-driven export and erasure.
CREATE TABLE "wordpress_recipe_sources" (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
  name TEXT NOT NULL,
  "siteUrl" TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  "allTargets" BOOLEAN NOT NULL DEFAULT TRUE,
  "targetIds" JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("targetIds") = 'array'),
  config JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  "lastRunAt" TIMESTAMP(3),
  "lastError" TEXT,
  "lastSummary" JSONB CHECK ("lastSummary" IS NULL OR jsonb_typeof("lastSummary") = 'object'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "wordpress_recipe_sources_workspace_key" ON "wordpress_recipe_sources" ("workspaceId");

-- One row per (source, page, slot): the unique key is the exactly-once claim, taken before any post is created.
-- 'claimed' is an unfinished claim; a stale one becomes 'uncertain' and is never retried automatically.
CREATE TABLE "wordpress_recipe_plans" (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "sourceId" TEXT NOT NULL REFERENCES "wordpress_recipe_sources"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "targetId" TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "wpPostId" TEXT NOT NULL,
  "slotAt" TIMESTAMP(3) NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('claimed', 'planned', 'uncertain', 'failed')),
  "postId" TEXT,
  title TEXT NOT NULL DEFAULT '',
  permalink TEXT,
  reason TEXT,
  skipped JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(skipped) = 'array'),
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (state <> 'planned' OR "postId" IS NOT NULL)
);
CREATE UNIQUE INDEX "wordpress_recipe_plans_slot_key" ON "wordpress_recipe_plans" ("sourceId", "targetId", "slotAt");
CREATE INDEX "wordpress_recipe_plans_recipe_idx" ON "wordpress_recipe_plans" ("sourceId", "wpPostId");
CREATE INDEX "wordpress_recipe_plans_workspace_slot_idx" ON "wordpress_recipe_plans" ("workspaceId", "slotAt");

CREATE FUNCTION rebuild_wordpress_recipe_plan_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM targets WHERE id = NEW."targetId" AND "workspaceId" = NEW."workspaceId")
     OR NOT EXISTS (SELECT 1 FROM "wordpress_recipe_sources" WHERE id = NEW."sourceId" AND "workspaceId" = NEW."workspaceId") THEN
    RAISE EXCEPTION 'WordPress recipe plan binding mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rebuild_wordpress_recipe_plan_binding BEFORE INSERT OR UPDATE ON "wordpress_recipe_plans"
  FOR EACH ROW EXECUTE FUNCTION rebuild_wordpress_recipe_plan_binding();
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "wordpress_recipe_plans"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "wordpress_recipe_sources"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
COMMIT;
