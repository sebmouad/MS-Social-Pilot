-- Recipe autopilot (2026-11-16): the caption style a slot's post was written in, so the styles that do best are learned. Idempotent.
ALTER TABLE wordpress_recipe_plans ADD COLUMN IF NOT EXISTS style TEXT;
