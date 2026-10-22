-- AlterEnum
ALTER TYPE "AiGenerationKind" ADD VALUE 'sentiment';

-- AlterTable
ALTER TABLE "post_comments" ADD COLUMN     "sentiment" TEXT;

-- AlterTable
ALTER TABLE "targets" ADD COLUMN     "negativeAlertAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "watchNegativeComments" BOOLEAN NOT NULL DEFAULT false;

