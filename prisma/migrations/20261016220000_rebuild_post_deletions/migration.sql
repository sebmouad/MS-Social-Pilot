-- Durable, content-free recovery journal and tombstones for remote post deletion.
CREATE TABLE "rebuild_post_deletions" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "remoteId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "localPostIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "localPostTargetIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "state" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "remoteConfirmedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "rebuild_post_deletions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rebuild_post_deletions_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_post_deletions_state_check"
    CHECK ("state" IN ('started', 'uncertain', 'remote_confirmed', 'completed', 'rejected')),
  CONSTRAINT "rebuild_post_deletions_reason_check"
    CHECK ("reason" IS NULL OR "reason" IN ('transport_unconfirmed', 'provider_rejected', 'external_not_deleted', 'local_pending')),
  CONSTRAINT "rebuild_post_deletions_timestamps_check"
    CHECK ((
      ("state" = 'started' AND "reason" IS NULL AND "remoteConfirmedAt" IS NULL AND "completedAt" IS NULL)
      OR ("state" = 'uncertain' AND "reason" = 'transport_unconfirmed' AND "remoteConfirmedAt" IS NULL AND "completedAt" IS NULL)
      OR ("state" = 'remote_confirmed' AND "reason" = 'local_pending' AND "remoteConfirmedAt" IS NOT NULL AND "completedAt" IS NULL)
      OR ("state" = 'completed' AND "reason" IS NULL AND "remoteConfirmedAt" IS NOT NULL AND "completedAt" IS NOT NULL)
      OR ("state" = 'rejected' AND "reason" IN ('provider_rejected', 'external_not_deleted') AND "remoteConfirmedAt" IS NULL AND "completedAt" IS NULL)
    ) IS TRUE)
);

CREATE UNIQUE INDEX "rebuild_post_deletions_active_remote_identity_key"
  ON "rebuild_post_deletions"("workspaceId", "provider", "targetId", "remoteId")
  WHERE "state" <> 'rejected';
CREATE INDEX "rebuild_post_deletions_workspaceId_targetId_updatedAt_idx"
  ON "rebuild_post_deletions"("workspaceId", "targetId", "updatedAt");
CREATE INDEX "rebuild_post_deletions_localPostIds_gin_idx"
  ON "rebuild_post_deletions" USING GIN ("localPostIds");
