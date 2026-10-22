CREATE TABLE "changelog_entries" (
    "id" TEXT NOT NULL,
    "publishedOn" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "changelog_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "changelog_entries_publishedOn_idx" ON "changelog_entries"("publishedOn");
