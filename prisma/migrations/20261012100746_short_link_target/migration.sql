-- AlterTable
ALTER TABLE "short_links" ADD COLUMN     "targetId" TEXT;

-- CreateIndex
CREATE INDEX "short_links_targetId_idx" ON "short_links"("targetId");

-- AddForeignKey
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

