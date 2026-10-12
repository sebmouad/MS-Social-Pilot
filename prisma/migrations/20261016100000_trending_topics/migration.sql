-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "trendKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "trending_topics" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "traffic" TEXT,
    "newsTitle" TEXT,
    "newsUrl" TEXT,
    "startedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trending_topics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trending_topics_country_fetchedAt_idx" ON "trending_topics"("country", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "trending_topics_country_title_key" ON "trending_topics"("country", "title");

