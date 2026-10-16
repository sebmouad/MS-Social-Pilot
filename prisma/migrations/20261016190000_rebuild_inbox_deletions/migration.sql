-- Durable, content-free recovery journal for Inbox remote deletions.
CREATE TABLE "rebuild_inbox_deletions" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "remoteId" TEXT NOT NULL,
  "localItemId" TEXT NOT NULL,
  "localAliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "suppressedRemoteIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "actorId" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "remoteConfirmedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "rebuild_inbox_deletions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rebuild_inbox_deletions_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_inbox_deletions_state_check"
    CHECK ("state" IN ('started', 'uncertain', 'remote_confirmed', 'completed', 'rejected')),
  CONSTRAINT "rebuild_inbox_deletions_reason_check"
    CHECK ("reason" IS NULL OR "reason" IN ('transport_unconfirmed', 'provider_rejected', 'local_pending')),
  CONSTRAINT "rebuild_inbox_deletions_timestamps_check"
    CHECK (
      ("state" <> 'completed' OR ("remoteConfirmedAt" IS NOT NULL AND "completedAt" IS NOT NULL))
      AND ("state" <> 'remote_confirmed' OR "remoteConfirmedAt" IS NOT NULL)
      AND ("state" IN ('completed', 'remote_confirmed') OR "completedAt" IS NULL)
    )
);

CREATE UNIQUE INDEX "rebuild_inbox_deletions_workspaceId_provider_targetId_remoteId_key"
  ON "rebuild_inbox_deletions"("workspaceId", "provider", "targetId", "remoteId");
CREATE INDEX "rebuild_inbox_deletions_workspaceId_targetId_updatedAt_idx"
  ON "rebuild_inbox_deletions"("workspaceId", "targetId", "updatedAt");
