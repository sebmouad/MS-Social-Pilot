-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "bestTimeMode" TEXT NOT NULL DEFAULT 'suggest',
ADD COLUMN     "bestTimesRunAt" TIMESTAMP(3);

