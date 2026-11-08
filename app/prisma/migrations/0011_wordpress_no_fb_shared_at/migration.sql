-- Social Pilot plans its own posts and keeps its own history: it no longer skips a WordPress post
-- marked `fb_shared_at`, a field MS FB Posts 1.8 stopped writing (its share marks are per image).
-- Saved defaults and sources that named it read no already-shared field. Idempotent.
UPDATE app_settings SET value = '""'::jsonb, "updatedAt" = NOW()
  WHERE key = 'feeds.wordpress.skipMetaKey' AND value = '"fb_shared_at"'::jsonb;
UPDATE wordpress_recipe_sources SET config = jsonb_set(config::jsonb, '{mapping,skipMetaKey}', '""'::jsonb)
  WHERE config::jsonb #>> '{mapping,skipMetaKey}' = 'fb_shared_at';
