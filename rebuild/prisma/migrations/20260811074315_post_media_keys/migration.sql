-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "mediaKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "posts_mediaKeys_idx" ON "posts" USING GIN ("mediaKeys");

-- Backfill from the existing Json payload, so posts written before this
-- column existed are still found by a media lookup. Both the id and the
-- storage key go in: a re-upload of the same bytes reuses the key while the
-- row id changes, and either one identifies the file.
UPDATE "posts" AS p
SET "mediaKeys" = COALESCE(k.keys, ARRAY[]::text[])
FROM (
  SELECT
    p2.id AS post_id,
    ARRAY(
      SELECT DISTINCT ref
      FROM jsonb_array_elements(p2.media::jsonb) AS item,
           LATERAL (VALUES (item ->> 'id'), (item ->> 'storageKey')) AS candidates(ref)
      WHERE ref IS NOT NULL
    ) AS keys
  FROM "posts" p2
  WHERE jsonb_typeof(p2.media::jsonb) = 'array'
) AS k
WHERE p.id = k.post_id;
