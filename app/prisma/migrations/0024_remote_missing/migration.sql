-- A post deleted on Facebook is recorded (2026-11-21): post_targets already has "remoteMissingAt"; the Page feed copy gets it too.
ALTER TABLE "external_posts" ADD COLUMN "remoteMissingAt" TIMESTAMP(3);
