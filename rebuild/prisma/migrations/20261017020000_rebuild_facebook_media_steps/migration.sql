-- Content-free intent and receipt journal for Facebook's unpublished photo uploads.
-- Provider objects remain recoverable across a process crash without retaining media bytes or URLs.
CREATE TABLE "rebuild_facebook_media_steps" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "postTargetId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "remoteTargetId" TEXT NOT NULL,
  "phase" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "remoteId" TEXT,
  "receiptAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rebuild_facebook_media_steps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rebuild_facebook_media_steps_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_facebook_media_steps_phase_ordinal_check"
    CHECK ((("phase" = 'photo' AND "ordinal" BETWEEN 1 AND 20) OR ("phase" = 'feed' AND "ordinal" = 0)) IS TRUE),
  CONSTRAINT "rebuild_facebook_media_steps_state_check"
    CHECK ("state" IN ('started', 'recorded', 'rejected', 'uncertain')),
  CONSTRAINT "rebuild_facebook_media_steps_bounds_check"
    CHECK (
      length("id") BETWEEN 1 AND 2048 AND
      length("workspaceId") BETWEEN 1 AND 2048 AND
      length("operationId") BETWEEN 1 AND 2048 AND
      length("postId") BETWEEN 1 AND 2048 AND
      length("postTargetId") BETWEEN 1 AND 2048 AND
      length("targetId") BETWEEN 1 AND 2048 AND
      length("actorId") BETWEEN 1 AND 2048 AND
      length("remoteTargetId") BETWEEN 1 AND 2048 AND
      ("remoteId" IS NULL OR length("remoteId") BETWEEN 1 AND 2048)
    ),
  CONSTRAINT "rebuild_facebook_media_steps_state_timestamps_check"
    CHECK ((
      ("state" = 'started' AND "remoteId" IS NULL AND "receiptAt" IS NULL AND "rejectedAt" IS NULL) OR
      ("state" = 'recorded' AND "remoteId" IS NOT NULL AND "receiptAt" IS NOT NULL AND "rejectedAt" IS NULL) OR
      ("state" = 'rejected' AND "remoteId" IS NULL AND "receiptAt" IS NULL AND "rejectedAt" IS NOT NULL) OR
      ("state" = 'uncertain' AND "remoteId" IS NULL AND "receiptAt" IS NULL AND "rejectedAt" IS NULL)
    ) IS TRUE),
  CONSTRAINT "rebuild_facebook_media_steps_time_order_check"
    CHECK (("createdAt" <= "updatedAt" AND ("receiptAt" IS NULL OR "receiptAt" <= "updatedAt") AND ("rejectedAt" IS NULL OR "rejectedAt" <= "updatedAt")) IS TRUE)
);

CREATE UNIQUE INDEX "rebuild_facebook_media_steps_operation_phase_ordinal_key"
  ON "rebuild_facebook_media_steps"("operationId", "phase", "ordinal");
CREATE INDEX "rebuild_facebook_media_steps_workspace_operation_idx"
  ON "rebuild_facebook_media_steps"("workspaceId", "operationId", "phase", "ordinal");
CREATE INDEX "rebuild_facebook_media_steps_workspace_target_updated_idx"
  ON "rebuild_facebook_media_steps"("workspaceId", "targetId", "updatedAt");
CREATE UNIQUE INDEX "rebuild_facebook_media_steps_known_remote_id_key"
  ON "rebuild_facebook_media_steps"("workspaceId", "targetId", "phase", "remoteId")
  WHERE "remoteId" IS NOT NULL;
