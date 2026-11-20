-- Photo ratings carry the version of the rules that rated them (2026-11-20): photos rated with older rules are rated again.
ALTER TABLE recipe_ratings ADD COLUMN IF NOT EXISTS "photoVersion" SMALLINT;
