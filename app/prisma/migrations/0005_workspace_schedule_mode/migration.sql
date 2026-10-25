-- Each workspace chooses where its scheduled posts wait (the application or the platform); NULL follows the Root default.
ALTER TABLE "workspaces" ADD COLUMN "scheduleMode" TEXT;
