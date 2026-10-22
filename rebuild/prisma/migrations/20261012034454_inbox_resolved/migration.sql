-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "post_comments" ADD COLUMN     "resolvedAt" TIMESTAMP(3);

