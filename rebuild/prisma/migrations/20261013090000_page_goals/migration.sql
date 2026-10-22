-- CreateTable
CREATE TABLE "page_goals" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "page_goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_goals_workspaceId_idx" ON "page_goals"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "page_goals_targetId_metric_key" ON "page_goals"("targetId", "metric");

-- AddForeignKey
ALTER TABLE "page_goals" ADD CONSTRAINT "page_goals_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_goals" ADD CONSTRAINT "page_goals_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

