-- Distributed lease and append-only outcome history for the replacement worker.
CREATE TABLE "rebuild_job_leases" (
  "name" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rebuild_job_leases_pkey" PRIMARY KEY ("name")
);
CREATE INDEX "rebuild_job_leases_leaseExpiresAt_idx" ON "rebuild_job_leases"("leaseExpiresAt");

CREATE TABLE "rebuild_sync_runs" (
  "id" TEXT NOT NULL,
  "job" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "outcome" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "summary" TEXT,
  "error" TEXT,
  CONSTRAINT "rebuild_sync_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rebuild_sync_runs_job_startedAt_idx" ON "rebuild_sync_runs"("job", "startedAt");
CREATE INDEX "rebuild_sync_runs_finishedAt_idx" ON "rebuild_sync_runs"("finishedAt");
