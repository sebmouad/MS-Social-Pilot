CREATE TABLE rebuild_notifications (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 2048),
  "eventId" TEXT NOT NULL CHECK (length("eventId") BETWEEN 1 AND 2048),
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('note_mention', 'mix_dry')),
  "postId" TEXT REFERENCES posts(id) ON DELETE CASCADE,
  "noteId" TEXT REFERENCES post_notes(id) ON DELETE CASCADE,
  "targetId" TEXT REFERENCES targets(id) ON DELETE CASCADE,
  "labelId" TEXT REFERENCES labels(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "readAt" TIMESTAMPTZ,
  "emailSentAt" TIMESTAMPTZ,
  "lastAttemptAt" TIMESTAMPTZ,
  "emailState" TEXT NOT NULL DEFAULT 'pending' CHECK ("emailState" IN ('pending', 'sending', 'sent', 'failed', 'uncertain', 'cancelled')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  "nextAt" TIMESTAMPTZ,
  "claimToken" TEXT,
  "claimUntil" TIMESTAMPTZ,
  "safeReason" TEXT CHECK ("safeReason" IS NULL OR "safeReason" IN ('recipient_unavailable', 'preflight_unavailable', 'mail_unavailable', 'mail_failed', 'mail_uncertain', 'claim_expired', 'authorization_changed', 'resource_unavailable')),
  CONSTRAINT rebuild_notifications_claim_shape CHECK (("emailState" = 'sending') = ("claimToken" IS NOT NULL AND "claimUntil" IS NOT NULL)),
  CONSTRAINT rebuild_notifications_sent_shape CHECK (("emailState" = 'sent') = ("emailSentAt" IS NOT NULL)),
  CONSTRAINT rebuild_notifications_attempt_shape CHECK ((attempt = 0) = ("lastAttemptAt" IS NULL)),
  CONSTRAINT rebuild_notifications_context_shape CHECK (
    (kind = 'note_mention' AND "postId" IS NOT NULL AND "noteId" IS NOT NULL)
    OR (kind = 'mix_dry' AND "targetId" IS NOT NULL)
  ),
  CONSTRAINT rebuild_notifications_id_workspace_cap CHECK (
    length("eventId") <= 2048 AND length("workspaceId") <= 2048 AND length("userId") <= 2048
  )
);

CREATE UNIQUE INDEX rebuild_notifications_event_recipient_uq
  ON rebuild_notifications ("workspaceId", "eventId", "userId");
CREATE INDEX rebuild_notifications_recipient_page_idx
  ON rebuild_notifications ("workspaceId", "userId", "createdAt" DESC, id DESC);
CREATE INDEX rebuild_notifications_delivery_due_idx
  ON rebuild_notifications ("nextAt", "createdAt", id)
  WHERE "emailState" = 'pending';
CREATE INDEX rebuild_notifications_delivery_lease_idx
  ON rebuild_notifications ("claimUntil", id)
  WHERE "emailState" = 'sending';
