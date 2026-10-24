-- Supervised autopilot tiers, per-language post variants and link-preview cache (idea batch 2).
-- Additive only: three new tables plus one nullable column. Existing rows are not rewritten.
--
-- Workspace boundary: every new workspace-owned row references workspaces(id) with
-- ON DELETE CASCADE, so workspace erasure and exports need no table-specific handling.
-- Lifecycle:
--   * deleting a workspace deletes its autopilot policy and variants (ON DELETE CASCADE);
--   * deleting a post deletes its language variants (ON DELETE CASCADE);
--   * deleting a user keeps the autopilot policy but clears the author (ON DELETE SET NULL);
--   * link_preview_cache is installation-wide and expires by fetchedAt/expiresAt; no FK.

CREATE TABLE "autopilot_policies" (
  "workspaceId" TEXT NOT NULL,
  "tier" TEXT NOT NULL DEFAULT 'assisted',
  "guardrails" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "autopilot_policies_pkey" PRIMARY KEY ("workspaceId"),
  CONSTRAINT "autopilot_policies_tier_check" CHECK ("tier" IN ('manual', 'assisted', 'supervised_auto')),
  CONSTRAINT "autopilot_policies_guardrails_check" CHECK (jsonb_typeof("guardrails") = 'object')
);

CREATE TABLE "post_language_variants" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "post_language_variants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "post_language_variants_post_locale_unique" UNIQUE ("postId", "locale"),
  -- BCP 47 short tags only: language, optionally with a region (en, fr, fr-CA).
  CONSTRAINT "post_language_variants_locale_check" CHECK ("locale" ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  CONSTRAINT "post_language_variants_message_check" CHECK (char_length(btrim("message")) > 0 AND char_length("message") <= 100000)
);

CREATE INDEX "post_language_variants_postId_idx" ON "post_language_variants"("postId");
CREATE INDEX "post_language_variants_workspaceId_idx" ON "post_language_variants"("workspaceId");

ALTER TABLE "post_language_variants" ADD CONSTRAINT "post_language_variants_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_language_variants" ADD CONSTRAINT "post_language_variants_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "autopilot_policies" ADD CONSTRAINT "autopilot_policies_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "autopilot_policies" ADD CONSTRAINT "autopilot_policies_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Effective destination language for variant selection. Null follows the workspace default
-- locale; the variant fallback rule is documented in publishing/server/post-variants.ts.
ALTER TABLE "targets" ADD COLUMN "locale" TEXT;
ALTER TABLE "targets" ADD CONSTRAINT "targets_locale_check" CHECK ("locale" IS NULL OR "locale" ~ '^[a-z]{2}(-[A-Z]{2})?$');

CREATE TABLE "link_preview_cache" (
  "urlHash" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "preview" JSONB NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "link_preview_cache_pkey" PRIMARY KEY ("urlHash"),
  CONSTRAINT "link_preview_cache_preview_check" CHECK (jsonb_typeof("preview") = 'object')
);
CREATE INDEX "link_preview_cache_expiresAt_idx" ON "link_preview_cache"("expiresAt");

-- New tables must join the workspace purge write gate, otherwise a row could
-- be written while the workspace is being erased. The shared cache table has no
-- workspace column, so it stays outside the gate like other shared storage.
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "autopilot_policies"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "post_language_variants"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
