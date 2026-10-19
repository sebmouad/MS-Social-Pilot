-- Additive neutral per-destination intent. NULL retains an existing legacy
-- destination's post-level format; newly authored destinations store an ID.
ALTER TABLE post_targets ADD COLUMN "formatId" text;
ALTER TABLE post_targets ADD CONSTRAINT rebuild_destination_format_identity
  CHECK ("formatId" IS NULL OR (char_length("formatId") BETWEEN 1 AND 128 AND "formatId" = btrim("formatId")));
-- Versions retain the exact target -> format map that was reviewed or edited.
ALTER TABLE post_versions ADD COLUMN "destinationFormats" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE post_versions ADD CONSTRAINT rebuild_version_destination_formats_object
  CHECK (jsonb_typeof("destinationFormats") = 'object');
