-- One-time history reads (2026-11-14): a newly linked Page or ad account used to start with only its last 7 or 30 days.
-- Pages keep their progress in facebook_sync_cursors (kind 'page_backfill'); ad accounts get their own small table
-- because facebook_sync_cursors is bound to Pages. Idempotent.
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'facebook_sync_cursors'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%kind%' LOOP
    EXECUTE format('ALTER TABLE facebook_sync_cursors DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE facebook_sync_cursors ADD CONSTRAINT facebook_sync_cursors_kind_check CHECK (kind IN ('post_history', 'page_backfill'));

CREATE TABLE IF NOT EXISTS facebook_ads_backfill (
  "adAccountId" TEXT PRIMARY KEY REFERENCES ad_accounts(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
  cursor JSONB NOT NULL CHECK (jsonb_typeof(cursor) = 'object'),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
