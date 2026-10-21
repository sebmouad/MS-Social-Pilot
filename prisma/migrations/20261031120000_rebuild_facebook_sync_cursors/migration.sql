BEGIN;
-- Provider job state belongs outside the Root configuration registry.
-- Direct workspace FK participates in the catalog-driven export and erasure.
CREATE TABLE "rebuild_facebook_sync_cursors" (
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "targetId" TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "providerId" TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('post_history')),
  cursor JSONB NOT NULL CHECK (jsonb_typeof(cursor) = 'object'),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("workspaceId", "targetId", kind)
);

CREATE FUNCTION rebuild_facebook_sync_cursor_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM targets WHERE id = NEW."targetId" AND "workspaceId" = NEW."workspaceId" AND "providerId" = NEW."providerId") THEN
    RAISE EXCEPTION 'Facebook cursor target binding mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rebuild_facebook_sync_cursor_binding BEFORE INSERT OR UPDATE ON rebuild_facebook_sync_cursors
  FOR EACH ROW EXECUTE FUNCTION rebuild_facebook_sync_cursor_binding();
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON rebuild_facebook_sync_cursors
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();

-- Exact joined keys avoid parsing IDs using dots. Only current target bindings
-- are reusable; stale/deleted target progress is disposable job state.
INSERT INTO rebuild_facebook_sync_cursors ("workspaceId", "targetId", "providerId", kind, cursor, "updatedAt")
SELECT t."workspaceId", t.id, t."providerId", 'post_history', s.value, s."updatedAt"
FROM app_settings s JOIN targets t ON s.key = 'facebook.history.' || t."workspaceId" || '.' || t.id || '.' || t."providerId"
WHERE NOT s.encrypted AND jsonb_typeof(s.value) = 'object';
DELETE FROM app_settings WHERE key LIKE 'facebook.history.%';

CREATE INDEX rebuild_facebook_sync_cursors_target_idx ON rebuild_facebook_sync_cursors ("targetId");
COMMIT;
