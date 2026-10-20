ALTER TABLE rebuild_notifications ADD COLUMN "accountId" TEXT REFERENCES social_accounts(id) ON DELETE CASCADE;
ALTER TABLE rebuild_notifications DROP CONSTRAINT rebuild_notifications_kind_check;
ALTER TABLE rebuild_notifications ADD CONSTRAINT rebuild_notifications_kind_check CHECK (kind IN ('note_mention','mix_dry','publish_failure','connection_expired','token_expiring','approval_request','approval_decision','inbox_digest','queue_empty','draft_updated','moderation_alert','negative_spike'));
ALTER TABLE rebuild_notifications DROP CONSTRAINT rebuild_notifications_context_shape;
ALTER TABLE rebuild_notifications ADD CONSTRAINT rebuild_notifications_context_shape CHECK (
 (kind = 'note_mention' AND "postId" IS NOT NULL AND "noteId" IS NOT NULL)
 OR (kind IN ('mix_dry','inbox_digest','queue_empty','moderation_alert','negative_spike') AND "targetId" IS NOT NULL)
 OR (kind IN ('publish_failure','approval_request','approval_decision','draft_updated') AND "postId" IS NOT NULL)
 OR (kind IN ('connection_expired','token_expiring') AND "accountId" IS NOT NULL)
);
