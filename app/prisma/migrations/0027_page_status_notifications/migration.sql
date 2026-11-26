-- A Page's Facebook integrity status changed (2026-11-26): the autopilot reads each Page's status daily (Page
-- Integrity API) and alerts owners and admins when one moves to warning, restricted or suspended. The notification
-- names the Page (targetId). Existing rows satisfy the new checks. Idempotent.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'note_mention', 'inbox_note_mention', 'mix_dry', 'publish_failure', 'connection_expired', 'token_expiring',
  'approval_request', 'approval_decision', 'inbox_digest', 'queue_empty', 'draft_updated', 'moderation_alert',
  'negative_spike', 'metric_alert', 'report_delivered', 'triage_assigned', 'autopilot_board', 'autopilot_report',
  'page_status'
));
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_context_shape;
ALTER TABLE notifications ADD CONSTRAINT notifications_context_shape CHECK (
  (kind = 'note_mention' AND "postId" IS NOT NULL AND "noteId" IS NOT NULL)
  OR (kind = 'inbox_note_mention' AND "targetId" IS NOT NULL AND "noteId" IS NOT NULL)
  OR (kind IN ('mix_dry', 'inbox_digest', 'queue_empty', 'moderation_alert', 'negative_spike', 'metric_alert', 'report_delivered', 'triage_assigned', 'page_status') AND "targetId" IS NOT NULL)
  OR (kind IN ('publish_failure', 'approval_request', 'approval_decision', 'draft_updated') AND "postId" IS NOT NULL)
  OR (kind IN ('connection_expired', 'token_expiring') AND "accountId" IS NOT NULL)
  OR (kind IN ('autopilot_board', 'autopilot_report'))
);
