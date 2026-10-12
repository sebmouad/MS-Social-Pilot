-- AlterTable
ALTER TABLE "conversation_messages" ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "notification_settings" ADD COLUMN     "inboxDigestAt" TIMESTAMP(3),
ADD COLUMN     "onNewInbox" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "post_comments" ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "notification_mutes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "event" TEXT NOT NULL,

    CONSTRAINT "notification_mutes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_mutes_targetId_event_idx" ON "notification_mutes"("targetId", "event");

-- CreateIndex
CREATE UNIQUE INDEX "notification_mutes_userId_targetId_event_key" ON "notification_mutes"("userId", "targetId", "event");

-- AddForeignKey
ALTER TABLE "notification_mutes" ADD CONSTRAINT "notification_mutes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_mutes" ADD CONSTRAINT "notification_mutes_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

