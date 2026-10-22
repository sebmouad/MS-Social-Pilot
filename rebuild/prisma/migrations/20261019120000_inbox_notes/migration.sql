CREATE TABLE "inbox_notes" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inbox_notes_workspaceId_kind_itemId_idx" ON "inbox_notes"("workspaceId", "kind", "itemId");

ALTER TABLE "inbox_notes" ADD CONSTRAINT "inbox_notes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inbox_notes" ADD CONSTRAINT "inbox_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
