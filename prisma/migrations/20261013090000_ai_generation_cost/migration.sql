-- AlterTable
ALTER TABLE "ai_generations" ADD COLUMN     "costUsd" DOUBLE PRECISION,
ADD COLUMN     "provider" TEXT;

-- CreateIndex
CREATE INDEX "ai_generations_createdAt_idx" ON "ai_generations"("createdAt");

