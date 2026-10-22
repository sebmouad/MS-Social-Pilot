-- Durable, content-free publication intent, receipt, and resolution journal.
-- Identifier bounds are fixed integrity caps (2048 characters) independent of runtime configuration.
CREATE TABLE "rebuild_publication_attempts" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "postTargetId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "reason" TEXT,
  "remotePostId" TEXT,
  "remoteUrl" TEXT,
  "receiptAt" TIMESTAMP(3),
  "projectedAt" TIMESTAMP(3),
  "attestedAt" TIMESTAMP(3),
  "attestedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rebuild_publication_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rebuild_publication_attempts_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_publication_attempts_state_check"
    CHECK ("state" IN ('started', 'uncertain', 'receipt_recorded', 'projected', 'rejected', 'attested_absent')),
  CONSTRAINT "rebuild_publication_attempts_reason_check"
    CHECK ("reason" IS NULL OR "reason" IN ('provider_rejected', 'outcome_unknown', 'provider_receipt', 'external_human_attestation')),
  CONSTRAINT "rebuild_publication_attempts_bounds_check"
    CHECK ((
      length("id") BETWEEN 1 AND 2048 AND
      length("workspaceId") BETWEEN 1 AND 2048 AND
      length("postId") BETWEEN 1 AND 2048 AND
      length("postTargetId") BETWEEN 1 AND 2048 AND
      length("targetId") BETWEEN 1 AND 2048 AND
      length("provider") BETWEEN 1 AND 2048 AND
      length("actorId") BETWEEN 1 AND 2048 AND
      ("attestedBy" IS NULL OR length("attestedBy") BETWEEN 1 AND 2048) AND
      ("remotePostId" IS NULL OR length("remotePostId") BETWEEN 1 AND 2048) AND
      ("remoteUrl" IS NULL OR length("remoteUrl") BETWEEN 1 AND 2048)
    ) IS TRUE),
  CONSTRAINT "rebuild_publication_attempts_state_timestamps_check"
    CHECK ((
      ("state" = 'started' AND "reason" IS NULL AND "remotePostId" IS NULL AND "remoteUrl" IS NULL AND "receiptAt" IS NULL AND "projectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL)
      OR ("state" = 'uncertain' AND "reason" = 'outcome_unknown' AND "remotePostId" IS NULL AND "remoteUrl" IS NULL AND "receiptAt" IS NULL AND "projectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL)
      OR ("state" = 'receipt_recorded' AND "reason" IN ('provider_receipt', 'external_human_attestation') AND "remotePostId" IS NOT NULL AND "receiptAt" IS NOT NULL AND "projectedAt" IS NULL AND (("reason" = 'provider_receipt' AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR ("reason" = 'external_human_attestation' AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL)))
      OR ("state" = 'projected' AND "reason" IN ('provider_receipt', 'external_human_attestation') AND "remotePostId" IS NOT NULL AND "receiptAt" IS NOT NULL AND "projectedAt" IS NOT NULL AND (("reason" = 'provider_receipt' AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR ("reason" = 'external_human_attestation' AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL)))
      OR ("state" = 'rejected' AND "reason" = 'provider_rejected' AND "remotePostId" IS NULL AND "remoteUrl" IS NULL AND "receiptAt" IS NULL AND "projectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL)
      OR ("state" = 'attested_absent' AND "reason" = 'external_human_attestation' AND "remotePostId" IS NULL AND "remoteUrl" IS NULL AND "receiptAt" IS NULL AND "projectedAt" IS NULL AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL)
    ) IS TRUE)
);

CREATE UNIQUE INDEX "rebuild_publication_attempts_active_postTarget_key"
  ON "rebuild_publication_attempts"("workspaceId", "postTargetId")
  WHERE "state" NOT IN ('rejected', 'attested_absent');
CREATE INDEX "rebuild_publication_attempts_workspaceId_targetId_updatedAt_idx"
  ON "rebuild_publication_attempts"("workspaceId", "targetId", "updatedAt");
CREATE INDEX "rebuild_publication_attempts_workspaceId_postId_postTargetId_idx"
  ON "rebuild_publication_attempts"("workspaceId", "postId", "postTargetId");
