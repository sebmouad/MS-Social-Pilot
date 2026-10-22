-- DropIndex
DROP INDEX "queue_slots_workspaceId_dayOfWeek_hour_minute_key";

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "allPages" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "firstCommentDelayMinutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "queue_slots" ADD COLUMN     "targetId" TEXT;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "reportFooter" TEXT,
ADD COLUMN     "reportSubtitle" TEXT,
ADD COLUMN     "reportTitle" TEXT;

-- CreateTable
CREATE TABLE "page_groups" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'blue',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "page_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_group_targets" (
    "groupId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,

    CONSTRAINT "page_group_targets_pkey" PRIMARY KEY ("groupId","targetId")
);

-- CreateTable
CREATE TABLE "member_page_access" (
    "membershipId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,

    CONSTRAINT "member_page_access_pkey" PRIMARY KEY ("membershipId","targetId")
);

-- CreateTable
CREATE TABLE "labels" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'blue',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_labels" (
    "postId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,

    CONSTRAINT "post_labels_pkey" PRIMARY KEY ("postId","labelId")
);

-- CreateIndex
CREATE UNIQUE INDEX "page_groups_workspaceId_name_key" ON "page_groups"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "page_group_targets_targetId_idx" ON "page_group_targets"("targetId");

-- CreateIndex
CREATE INDEX "member_page_access_targetId_idx" ON "member_page_access"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "labels_workspaceId_name_key" ON "labels"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "post_labels_labelId_idx" ON "post_labels"("labelId");

-- CreateIndex
CREATE INDEX "queue_slots_targetId_idx" ON "queue_slots"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "queue_slots_workspaceId_targetId_dayOfWeek_hour_minute_key" ON "queue_slots"("workspaceId", "targetId", "dayOfWeek", "hour", "minute");

-- AddForeignKey
ALTER TABLE "queue_slots" ADD CONSTRAINT "queue_slots_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_groups" ADD CONSTRAINT "page_groups_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_group_targets" ADD CONSTRAINT "page_group_targets_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "page_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_group_targets" ADD CONSTRAINT "page_group_targets_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_page_access" ADD CONSTRAINT "member_page_access_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_page_access" ADD CONSTRAINT "member_page_access_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_labels" ADD CONSTRAINT "post_labels_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_labels" ADD CONSTRAINT "post_labels_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A time every Page shares has no targetId, and Postgres treats NULLs as
-- distinct in a unique index. This one makes the shared times unique too.
CREATE UNIQUE INDEX "queue_slots_shared_time_key" ON "queue_slots"("workspaceId", "dayOfWeek", "hour", "minute") WHERE "targetId" IS NULL;
