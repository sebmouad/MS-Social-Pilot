-- Posts: workspace equality followed by the complete, deterministic list ordering.
-- The same btree supports ascending Home/queue and descending Posts scans.
CREATE INDEX IF NOT EXISTS rebuild_posts_workspace_schedule_order
  ON posts ("workspaceId", "scheduledAt", "createdAt", id);

-- Status-filtered lists (including Home's upcoming scheduled posts).
CREATE INDEX IF NOT EXISTS rebuild_posts_workspace_status_schedule_order
  ON posts ("workspaceId", status, "scheduledAt", "createdAt", id);

-- Oldest-created lists cannot use a schedule-leading index for their ordering.
CREATE INDEX IF NOT EXISTS rebuild_posts_workspace_created_order
  ON posts ("workspaceId", "createdAt", id);

-- Analytics range reads constrain target and endTime without constraining metric.
-- The existing (targetId, metric, endTime) index cannot narrow that date range.
CREATE INDEX IF NOT EXISTS rebuild_page_insights_target_time_metric
  ON page_insights ("targetId", "endTime", metric);
