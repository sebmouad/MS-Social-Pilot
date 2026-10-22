-- AlterTable
ALTER TABLE "worker_job_runs" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastErrorAt" TIMESTAMP(3),
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "summary" TEXT,
ALTER COLUMN "finishedAt" DROP NOT NULL;

-- CreateTable
CREATE TABLE "graph_usage" (
    "key" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graph_usage_pkey" PRIMARY KEY ("key")
);

