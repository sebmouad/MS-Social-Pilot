-- AlterEnum
ALTER TYPE "AiGenerationKind" ADD VALUE 'recap';

-- AlterTable
ALTER TABLE "report_schedules" ADD COLUMN     "aiRecap" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "createdById" TEXT;

