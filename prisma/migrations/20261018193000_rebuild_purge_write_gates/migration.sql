-- Reconcile the database erasure guard for schema-built legacy installations.
-- The existing purge table and all customer rows are preserved. This prerequisite
-- must run before new workspace-owned module tables install the shared gate.
DO $$
BEGIN
  IF to_regclass('public.workspace_data_purges') IS NULL THEN
    RAISE EXCEPTION 'workspace_data_purges prerequisite table is missing';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rebuild_reject_purging_workspace_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  -- Erasure takes FOR UPDATE on this same parent. A concurrent child write
  -- must finish before erasure, or wait and observe the recorded purge state.
  PERFORM 1 FROM public.workspaces WHERE id = NEW."workspaceId" FOR SHARE;
  IF EXISTS (
    SELECT 1 FROM public.workspace_data_purges
    WHERE "workspaceId" = NEW."workspaceId" AND status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'Workspace data deletion is in progress'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE item record; installed record;
BEGIN
  FOR item IN
    SELECT DISTINCT child.oid, child.relname AS table_name
    FROM pg_constraint fk
    JOIN pg_class child ON child.oid = fk.conrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace
    WHERE fk.contype = 'f' AND fk.confrelid = 'public.workspaces'::regclass
      AND ns.nspname = 'public' AND child.relkind = 'r'
      AND child.relname NOT IN ('memberships', 'workspace_data_purges')
  LOOP
    SELECT tgfoid, tgenabled INTO installed FROM pg_trigger
      WHERE tgrelid = item.oid AND tgname = 'rebuild_workspace_purge_write_gate'
        AND NOT tgisinternal;
    IF FOUND THEN
      IF installed.tgfoid <> 'public.rebuild_reject_purging_workspace_write()'::regprocedure
         OR installed.tgenabled NOT IN ('O', 'A') THEN
        RAISE EXCEPTION 'Unexpected or disabled workspace purge gate on %', item.table_name;
      END IF;
    ELSE
      EXECUTE format('CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_workspace_write()', item.table_name);
    END IF;
  END LOOP;
END $$;
