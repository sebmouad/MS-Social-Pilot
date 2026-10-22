-- AlterTable
ALTER TABLE "targets" ADD COLUMN     "fanCount" INTEGER,
ADD COLUMN     "followersCount" INTEGER,
ADD COLUMN     "profileSyncedAt" TIMESTAMP(3),
ADD COLUMN     "talkingAboutCount" INTEGER;

-- CreateTable
CREATE TABLE "page_insights" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "value" JSONB NOT NULL,
    "numeric" DOUBLE PRECISION,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_availability" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL,
    "reason" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_availability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_insights_targetId_metric_endTime_idx" ON "page_insights"("targetId", "metric", "endTime");

-- CreateIndex
CREATE UNIQUE INDEX "page_insights_targetId_metric_period_endTime_key" ON "page_insights"("targetId", "metric", "period", "endTime");

-- CreateIndex
CREATE INDEX "metric_availability_targetId_idx" ON "metric_availability"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "metric_availability_targetId_metric_period_key" ON "metric_availability"("targetId", "metric", "period");

-- AddForeignKey
ALTER TABLE "page_insights" ADD CONSTRAINT "page_insights_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_availability" ADD CONSTRAINT "metric_availability_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
