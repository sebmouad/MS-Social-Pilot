-- Persist both halves of workspace data deletion so a crash after database
-- commit can resume filesystem cleanup without reopening the deleted rows.
CREATE TABLE "workspace_data_purges" (
  "workspaceId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'requested',
  "requestedById" TEXT NOT NULL,
  "apiKeyId" TEXT,
  "mediaRoot" TEXT NOT NULL,
  "counts" JSONB,
  "error" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dbDeletedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_data_purges_pkey" PRIMARY KEY ("workspaceId"),
  CONSTRAINT "workspace_data_purges_status_check" CHECK ("status" IN ('requested', 'db_deleted', 'completed'))
);

CREATE INDEX "workspace_data_purges_status_updatedAt_idx" ON "workspace_data_purges"("status", "updatedAt");
ALTER TABLE "workspace_data_purges" ADD CONSTRAINT "workspace_data_purges_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every directly workspace-owned legacy table gets the same write gate. Locking
-- the parent first orders a concurrent write against the purge's FOR UPDATE
-- lock; checking only the job row in a BEFORE trigger would leave a race.
CREATE FUNCTION rebuild_reject_purging_workspace_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM workspaces WHERE id = NEW."workspaceId" FOR SHARE;
  IF EXISTS (
    SELECT 1 FROM workspace_data_purges
    WHERE "workspaceId" = NEW."workspaceId" AND status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'Workspace data deletion is in progress'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT DISTINCT child.relname AS table_name
    FROM pg_constraint AS fk
    JOIN pg_class AS child ON child.oid = fk.conrelid
    JOIN pg_namespace AS ns ON ns.oid = child.relnamespace
    WHERE fk.contype = 'f' AND fk.confrelid = 'public.workspaces'::regclass
      AND ns.nspname = 'public' AND child.relkind = 'r'
      AND child.relname NOT IN ('memberships', 'workspace_data_purges')
  LOOP
    EXECUTE format('CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write()', item.table_name);
  END LOOP;
END $$;
