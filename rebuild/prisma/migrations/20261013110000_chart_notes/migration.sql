-- CreateTable
CREATE TABLE "chart_notes" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "targetId" TEXT,
    "day" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'blue',
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chart_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chart_notes_workspaceId_day_idx" ON "chart_notes"("workspaceId", "day");

-- AddForeignKey
ALTER TABLE "chart_notes" ADD CONSTRAINT "chart_notes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_notes" ADD CONSTRAINT "chart_notes_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_notes" ADD CONSTRAINT "chart_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

