-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "captionLabel" TEXT,
ADD COLUMN     "captionTestId" TEXT;

-- CreateTable
CREATE TABLE "caption_tests" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hours" INTEGER NOT NULL DEFAULT 48,
    "minViews" INTEGER NOT NULL DEFAULT 500,
    "status" TEXT NOT NULL DEFAULT 'running',
    "reason" TEXT,
    "winnerLabel" TEXT,
    "lift" DOUBLE PRECISION,
    "results" JSONB,
    "decidedAt" TIMESTAMP(3),
    "learnedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caption_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "caption_tests_workspaceId_createdAt_idx" ON "caption_tests"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "caption_tests_status_idx" ON "caption_tests"("status");

-- CreateIndex
CREATE INDEX "posts_captionTestId_idx" ON "posts"("captionTestId");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_captionTestId_fkey" FOREIGN KEY ("captionTestId") REFERENCES "caption_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caption_tests" ADD CONSTRAINT "caption_tests_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

