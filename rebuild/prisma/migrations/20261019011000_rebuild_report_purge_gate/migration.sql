-- The earlier reviewed purge gate predates report_runs. Join the same lock and
-- erasure guard without rewriting the already-applied report history migration.
DO $$
BEGIN
  IF to_regprocedure('public.rebuild_reject_purging_workspace_write()') IS NULL THEN
    RAISE EXCEPTION 'Shared workspace purge write gate prerequisite is missing';
  END IF;
END $$;
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON report_runs
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
