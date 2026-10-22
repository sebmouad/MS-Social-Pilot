CREATE TABLE "bio_pages" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "avatarUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bio_pages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bio_links" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bio_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bio_pages_workspaceId_key" ON "bio_pages"("workspaceId");
CREATE UNIQUE INDEX "bio_pages_slug_key" ON "bio_pages"("slug");
CREATE INDEX "bio_links_pageId_position_idx" ON "bio_links"("pageId", "position");

ALTER TABLE "bio_pages" ADD CONSTRAINT "bio_pages_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bio_links" ADD CONSTRAINT "bio_links_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "bio_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
