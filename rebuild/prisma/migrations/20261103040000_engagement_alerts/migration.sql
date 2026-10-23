-- Engagement batch: metric alert rules with worker-evaluated firings, new
-- notification email switches, and full-text search indexes over stored
-- inbox messages and comments. Additive only: two new tables, three new
-- nullable-safe columns with defaults, two expression indexes. Existing rows
-- are not rewritten.
--
-- Workspace boundary: every new workspace-owned row references workspaces(id)
-- with ON DELETE CASCADE, so workspace erasure and exports need no
-- table-specific handling (discovery is FK-based; see
-- src/server/data-control/index.ts).
-- Lifecycle:
--   * deleting a workspace deletes its alert rules and firings (CASCADE);
--   * deleting a channel (target) deletes its alert rules and their firings;
--   * deleting a user keeps rules/firings but clears the author (SET NULL);
--   * notification_settings switches default to true (email on) for new rows;
--     existing rows gain the same default, matching the other alert switches.

CREATE TABLE "metric_alert_rules" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "operator" TEXT NOT NULL,
  "threshold" DOUBLE PRECISION NOT NULL,
  "windowDays" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "metric_alert_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "metric_alert_rules_metric_check" CHECK ("metric" IN ('followers', 'views', 'engagements', 'posts')),
  CONSTRAINT "metric_alert_rules_operator_check" CHECK ("operator" IN ('above', 'below')),
  CONSTRAINT "metric_alert_rules_threshold_check" CHECK ("threshold" >= 0 AND "threshold" <= 1000000000),
  CONSTRAINT "metric_alert_rules_window_check" CHECK ("windowDays" IN (7, 30)),
  CONSTRAINT "metric_alert_rules_name_check" CHECK (char_length(btrim("name")) > 0 AND char_length("name") <= 80)
);

CREATE TABLE "metric_alert_firings" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "actual" DOUBLE PRECISION NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'fired',
  "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "metric_alert_firings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "metric_alert_firings_state_check" CHECK ("state" IN ('fired', 'resolved'))
);

-- One open firing per rule; resolved history is kept.
CREATE UNIQUE INDEX "metric_alert_firings_open_rule_uniq" ON "metric_alert_firings"("ruleId") WHERE "state" = 'fired';
CREATE INDEX "metric_alert_firings_workspace_idx" ON "metric_alert_firings"("workspaceId", "firedAt" DESC);
CREATE INDEX "metric_alert_rules_workspace_idx" ON "metric_alert_rules"("workspaceId", "targetId");

ALTER TABLE "metric_alert_rules" ADD CONSTRAINT "metric_alert_rules_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metric_alert_rules" ADD CONSTRAINT "metric_alert_rules_targetId_fkey"
  FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metric_alert_rules" ADD CONSTRAINT "metric_alert_rules_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "metric_alert_firings" ADD CONSTRAINT "metric_alert_firings_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metric_alert_firings" ADD CONSTRAINT "metric_alert_firings_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "metric_alert_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "metric_alert_rules"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "metric_alert_firings"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();

ALTER TABLE "notification_settings"
  ADD COLUMN "onMetricAlert" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "onReportDelivered" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "onTriageAssigned" BOOLEAN NOT NULL DEFAULT true;

-- Ranked full-text search over stored inbox content. The `simple`
-- configuration keeps matching predictable across English and French text
-- without language-specific stemming or stop words.
CREATE INDEX "conversation_messages_fts_idx" ON "conversation_messages"
  USING gin (to_tsvector('simple', coalesce("message", '') || ' ' || coalesce("fromName", '')));
CREATE INDEX "post_comments_fts_idx" ON "post_comments"
  USING gin (to_tsvector('simple', coalesce("message", '') || ' ' || coalesce("fromName", '')));
