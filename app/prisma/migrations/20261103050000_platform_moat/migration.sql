-- Platform/moat batch: Meta inbound-webhook delivery log and Analytics
-- precomputed daily/weekly rollups. Additive only: four new tables.
-- Existing rows are not rewritten.
--
-- Workspace boundary:
--   * meta_webhook_deliveries is installation operational history (like
--     rebuild_sync_runs): content-free delivery receipts (ids, kinds,
--     verbs, counts — never message text), retained under the Root
--     meta.webhookDeliveryRetentionDays bound. No workspace FK on purpose:
--     one event fans out to every workspace holding the Page, and unmatched
--     events belong to no workspace.
--   * analytics_rollup_daily / analytics_rollup_weekly are workspace-owned
--     derivatives of stored insights (one value per target/metric/day or
--     week). Every row references workspaces(id) and targets(id) with
--     ON DELETE CASCADE, so workspace erasure and channel deletion need no
--     table-specific handling (discovery is FK-based; see
--     src/server/data-control/index.ts).
--   * analytics_rollup_runs records worker coverage (window + targets) so
--     readers can prefer rollups only when a completed run covers the
--     request, and otherwise fall back to detailed stored reads.
-- Lifecycle:
--   * deleting a workspace deletes its rollup rows and run records (CASCADE);
--   * deleting a channel (target) deletes its rollup rows (CASCADE);
--   * run records keep no target FK (historical coverage snapshot only).

CREATE TABLE "meta_webhook_deliveries" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "eventKind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "matchedTargets" INTEGER NOT NULL DEFAULT 0,
  "detail" JSONB NOT NULL DEFAULT '{}',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meta_webhook_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meta_webhook_deliveries_event_uniq" UNIQUE ("eventId"),
  CONSTRAINT "meta_webhook_deliveries_status_check" CHECK ("status" IN ('accepted', 'duplicate', 'unmatched', 'ignored')),
  CONSTRAINT "meta_webhook_deliveries_kind_check" CHECK ("eventKind" IN ('feed_post', 'feed_comment', 'message', 'unknown'))
);
CREATE INDEX "meta_webhook_deliveries_provider_idx" ON "meta_webhook_deliveries"("provider", "receivedAt" DESC);

CREATE TABLE "analytics_rollup_daily" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "period" TEXT NOT NULL DEFAULT 'day',
  "day" DATE NOT NULL,
  "kind" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "samples" INTEGER NOT NULL,
  "asOf" TIMESTAMP(3) NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_rollup_daily_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "analytics_rollup_daily_kind_check" CHECK ("kind" IN ('flow', 'stock')),
  CONSTRAINT "analytics_rollup_daily_samples_check" CHECK ("samples" >= 1)
);
CREATE UNIQUE INDEX "analytics_rollup_daily_target_uniq" ON "analytics_rollup_daily"("targetId", "metric", "period", "day");
CREATE INDEX "analytics_rollup_daily_workspace_idx" ON "analytics_rollup_daily"("workspaceId", "provider", "day");

CREATE TABLE "analytics_rollup_weekly" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "period" TEXT NOT NULL DEFAULT 'day',
  "weekStart" DATE NOT NULL,
  "kind" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "samples" INTEGER NOT NULL,
  "asOf" TIMESTAMP(3) NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_rollup_weekly_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "analytics_rollup_weekly_kind_check" CHECK ("kind" IN ('flow', 'stock')),
  CONSTRAINT "analytics_rollup_weekly_samples_check" CHECK ("samples" >= 1)
);
CREATE UNIQUE INDEX "analytics_rollup_weekly_target_uniq" ON "analytics_rollup_weekly"("targetId", "metric", "period", "weekStart");
CREATE INDEX "analytics_rollup_weekly_workspace_idx" ON "analytics_rollup_weekly"("workspaceId", "provider", "weekStart");

CREATE TABLE "analytics_rollup_runs" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "granularity" TEXT NOT NULL,
  "windowFrom" TIMESTAMP(3) NOT NULL,
  "windowTo" TIMESTAMP(3) NOT NULL,
  "targetIds" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL,
  "examined" INTEGER NOT NULL DEFAULT 0,
  "written" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_rollup_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "analytics_rollup_runs_granularity_check" CHECK ("granularity" IN ('daily', 'weekly')),
  CONSTRAINT "analytics_rollup_runs_status_check" CHECK ("status" IN ('completed', 'partial', 'failed'))
);
CREATE INDEX "analytics_rollup_runs_workspace_idx" ON "analytics_rollup_runs"("workspaceId", "provider", "granularity", "finishedAt" DESC);

ALTER TABLE "analytics_rollup_daily" ADD CONSTRAINT "analytics_rollup_daily_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_rollup_daily" ADD CONSTRAINT "analytics_rollup_daily_targetId_fkey"
  FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_rollup_weekly" ADD CONSTRAINT "analytics_rollup_weekly_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_rollup_weekly" ADD CONSTRAINT "analytics_rollup_weekly_targetId_fkey"
  FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_rollup_runs" ADD CONSTRAINT "analytics_rollup_runs_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "analytics_rollup_daily"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "analytics_rollup_weekly"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "analytics_rollup_runs"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
