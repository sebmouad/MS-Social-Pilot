-- One row per running scheduler worker, so the setup screen can tell an
-- installation whose worker has never been started from one that is working.
CREATE TABLE "worker_heartbeats" (
    "workerId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobs" TEXT[],

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("workerId")
);

CREATE INDEX "worker_heartbeats_seenAt_idx" ON "worker_heartbeats"("seenAt");
