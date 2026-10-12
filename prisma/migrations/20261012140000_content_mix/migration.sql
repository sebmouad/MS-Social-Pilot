-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "mixAutoFill" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "content_mix_rules" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "targetId" TEXT,
    "groupId" TEXT,
    "labelId" TEXT NOT NULL,
    "perWeek" INTEGER NOT NULL,
    "dryNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_mix_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_mix_rules_workspaceId_idx" ON "content_mix_rules"("workspaceId");

-- AddForeignKey
ALTER TABLE "content_mix_rules" ADD CONSTRAINT "content_mix_rules_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_mix_rules" ADD CONSTRAINT "content_mix_rules_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_mix_rules" ADD CONSTRAINT "content_mix_rules_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "page_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_mix_rules" ADD CONSTRAINT "content_mix_rules_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

