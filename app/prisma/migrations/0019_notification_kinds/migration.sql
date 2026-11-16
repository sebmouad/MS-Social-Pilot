-- Every notification kind the app sends can be stored (2026-11-16). The kind and context checks had stopped at
-- twelve kinds: inbox note mentions, metric alerts, delivered reports, triage assignments and the autopilot's
-- notifications were refused by the database (a triage assignment, written in the same transaction, failed with
-- them). Inbox notes live in inbox_notes, so the note reference is no longer tied to post notes; a deleted note
-- leaves its notification shown as unavailable. Existing rows satisfy the new checks. Idempotent.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'note_mention', 'inbox_note_mention', 'mix_dry', 'publish_failure', 'connection_expired', 'token_expiring',
  'approval_request', 'approval_decision', 'inbox_digest', 'queue_empty', 'draft_updated', 'moderation_alert',
  'negative_spike', 'metric_alert', 'report_delivered', 'triage_assigned', 'autopilot_board', 'autopilot_report'
));
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_context_shape;
ALTER TABLE notifications ADD CONSTRAINT notifications_context_shape CHECK (
  (kind = 'note_mention' AND "postId" IS NOT NULL AND "noteId" IS NOT NULL)
  OR (kind = 'inbox_note_mention' AND "targetId" IS NOT NULL AND "noteId" IS NOT NULL)
  OR (kind IN ('mix_dry', 'inbox_digest', 'queue_empty', 'moderation_alert', 'negative_spike', 'metric_alert', 'report_delivered', 'triage_assigned') AND "targetId" IS NOT NULL)
  OR (kind IN ('publish_failure', 'approval_request', 'approval_decision', 'draft_updated') AND "postId" IS NOT NULL)
  OR (kind IN ('connection_expired', 'token_expiring') AND "accountId" IS NOT NULL)
  OR (kind IN ('autopilot_board', 'autopilot_report'))
);
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS "notifications_noteId_fkey";
