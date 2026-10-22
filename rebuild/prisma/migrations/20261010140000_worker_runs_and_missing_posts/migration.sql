-- A post Facebook no longer has, so the syncs stop asking about it.
ALTER TABLE "post_targets" ADD COLUMN "remoteMissingAt" TIMESTAMP(3);

-- When each background job last finished, kept across worker restarts.
CREATE TABLE "worker_job_runs" (
    "name" TEXT NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_job_runs_pkey" PRIMARY KEY ("name")
);
