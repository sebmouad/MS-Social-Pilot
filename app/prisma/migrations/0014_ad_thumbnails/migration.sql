-- Ad pictures in the Ads list (2026-11-15): each ad keeps the picture of its creative, read with the ads during sync.
-- Facebook's picture addresses expire after some days; every ads sync stores a fresh one. Idempotent.
ALTER TABLE ads_objects ADD COLUMN IF NOT EXISTS "thumbnailUrl" TEXT;
