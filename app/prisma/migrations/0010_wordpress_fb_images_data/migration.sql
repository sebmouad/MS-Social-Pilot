-- MS Recipes Writer AI 0.66.1 keeps a post's Facebook images only in `fb_images_data`, newest first, and
-- deletes `_msrwa_facebook_caption` and `_msrwa_facebook_generated`. Saved defaults and sources that named
-- those keys now read the first item of the list. Idempotent: only the old values are rewritten.
UPDATE app_settings SET value = '"fb_images_data.0.text"'::jsonb, "updatedAt" = NOW()
  WHERE key = 'feeds.wordpress.captionMetaKey' AND value = '"_msrwa_facebook_caption"'::jsonb;
UPDATE app_settings SET value = '"fb_images_data.0.id"'::jsonb, "updatedAt" = NOW()
  WHERE key = 'feeds.wordpress.imageMetaKey' AND value = '"_msrwa_facebook_generated"'::jsonb;
UPDATE wordpress_recipe_sources SET config = jsonb_set(config::jsonb, '{mapping,captionMetaKey}', '"fb_images_data.0.text"'::jsonb)
  WHERE config::jsonb #>> '{mapping,captionMetaKey}' = '_msrwa_facebook_caption';
UPDATE wordpress_recipe_sources SET config = jsonb_set(config::jsonb, '{mapping,imageMetaKey}', '"fb_images_data.0.id"'::jsonb)
  WHERE config::jsonb #>> '{mapping,imageMetaKey}' = '_msrwa_facebook_generated';
