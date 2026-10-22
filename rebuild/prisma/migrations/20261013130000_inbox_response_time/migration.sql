-- AlterTable
ALTER TABLE "conversation_messages" ADD COLUMN     "sentById" TEXT;

-- AlterTable
ALTER TABLE "post_comments" ADD COLUMN     "sentById" TEXT;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "businessDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "businessEnd" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN     "businessStart" INTEGER NOT NULL DEFAULT 9;

