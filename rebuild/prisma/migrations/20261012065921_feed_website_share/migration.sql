-- AlterTable
ALTER TABLE "feed_sources" ADD COLUMN     "hashtags" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'rss',
ADD COLUMN     "spreadMinutes" INTEGER NOT NULL DEFAULT 0;

