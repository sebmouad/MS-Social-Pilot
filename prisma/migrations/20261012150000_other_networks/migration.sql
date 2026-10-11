-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TargetType" ADD VALUE 'bluesky';
ALTER TYPE "TargetType" ADD VALUE 'mastodon';
ALTER TYPE "TargetType" ADD VALUE 'linkedin';
ALTER TYPE "TargetType" ADD VALUE 'threads';
ALTER TYPE "TargetType" ADD VALUE 'x';
ALTER TYPE "TargetType" ADD VALUE 'pinterest';

-- AlterTable
ALTER TABLE "social_accounts" ADD COLUMN     "meta" JSONB,
ADD COLUMN     "refreshToken" TEXT;

