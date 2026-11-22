-- Reach at fixed ages (2026-11-22): read once at 2–5 h and once at 22–30 h, so posts of different ages compare fairly.
ALTER TABLE "external_posts" ADD COLUMN "reach3h" INTEGER, ADD COLUMN "reach24h" INTEGER;
