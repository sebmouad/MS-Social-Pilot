-- AlterTable
ALTER TABLE "notification_settings" ADD COLUMN     "onNoteMention" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "post_notes" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "mentionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "post_notes_postId_createdAt_idx" ON "post_notes"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "post_notes_authorId_idx" ON "post_notes"("authorId");

-- AddForeignKey
ALTER TABLE "post_notes" ADD CONSTRAINT "post_notes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_notes" ADD CONSTRAINT "post_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

