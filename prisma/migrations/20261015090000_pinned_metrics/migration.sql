-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pinnedMetrics" TEXT[] DEFAULT ARRAY[]::TEXT[];

