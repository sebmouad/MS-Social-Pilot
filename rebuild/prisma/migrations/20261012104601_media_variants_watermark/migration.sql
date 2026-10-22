-- AlterTable
ALTER TABLE "media" ADD COLUMN     "derivedFromId" TEXT,
ADD COLUMN     "variant" TEXT;

-- AlterTable
ALTER TABLE "targets" ADD COLUMN     "watermark" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "media_derivedFromId_variant_key" ON "media"("derivedFromId", "variant");

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_derivedFromId_fkey" FOREIGN KEY ("derivedFromId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

