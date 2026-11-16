-- Recipe autopilot (2026-11-16): AI ratings of each recipe, kept so a recipe is rated once, and the score and kind
-- a planned slot was chosen with, shown in the plan. Idempotent.
CREATE TABLE IF NOT EXISTS recipe_ratings (
  "sourceId" TEXT NOT NULL,
  "wpPostId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  kind TEXT,
  hook SMALLINT,
  photo SMALLINT,
  "ratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "photoAt" TIMESTAMP(3),
  CONSTRAINT recipe_ratings_pkey PRIMARY KEY ("sourceId", "wpPostId")
);
CREATE INDEX IF NOT EXISTS recipe_ratings_workspace_idx ON recipe_ratings ("workspaceId");
ALTER TABLE wordpress_recipe_plans ADD COLUMN IF NOT EXISTS score SMALLINT;
ALTER TABLE wordpress_recipe_plans ADD COLUMN IF NOT EXISTS kind TEXT;
