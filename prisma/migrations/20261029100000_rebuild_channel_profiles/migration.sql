-- Channel labels are customer metadata, independent of provider categories and post labels.
CREATE TABLE rebuild_channel_profiles (
  "targetId" TEXT PRIMARY KEY REFERENCES targets(id) ON DELETE CASCADE,
  labels TEXT[] NOT NULL DEFAULT '{}'
);
