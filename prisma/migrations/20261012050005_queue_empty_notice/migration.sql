-- AlterTable
ALTER TABLE "notification_settings" ADD COLUMN     "onQueueEmpty" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "targets" ADD COLUMN     "queueEmptyNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "queueFilledAt" TIMESTAMP(3);

