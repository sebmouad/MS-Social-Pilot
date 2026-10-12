-- CreateTable
CREATE TABLE "workspace_exports" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "storageKey" TEXT,
    "bytes" INTEGER,
    "skippedMedia" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "workspace_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_exports_workspaceId_createdAt_idx" ON "workspace_exports"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "workspace_exports_status_idx" ON "workspace_exports"("status");

-- AddForeignKey
ALTER TABLE "workspace_exports" ADD CONSTRAINT "workspace_exports_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

