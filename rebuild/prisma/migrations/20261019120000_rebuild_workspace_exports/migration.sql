CREATE TABLE public.rebuild_workspace_exports (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  "requestedById" TEXT NOT NULL,
  "apiKeyId" TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','running','ready','failed','expired')),
  "mediaRoot" TEXT NOT NULL,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  error TEXT,
  bytes INTEGER
);
CREATE INDEX rebuild_workspace_exports_due ON public.rebuild_workspace_exports(status, "createdAt");
CREATE INDEX rebuild_workspace_exports_workspace ON public.rebuild_workspace_exports("workspaceId", "createdAt");
CREATE UNIQUE INDEX rebuild_workspace_exports_pending ON public.rebuild_workspace_exports("workspaceId") WHERE status IN ('requested','running');
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON public.rebuild_workspace_exports
 FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_workspace_write();

-- A deletion outbox deliberately survives its source job/workspace. Erasure first
-- deletes database rows, then removes files, possibly after a process restart.
CREATE TABLE public.rebuild_export_file_cleanups (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "mediaRoot" TEXT NOT NULL,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX rebuild_export_file_cleanups_workspace ON public.rebuild_export_file_cleanups("workspaceId");
CREATE FUNCTION public.rebuild_queue_export_file_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.rebuild_export_file_cleanups (id, "workspaceId", "mediaRoot")
    VALUES (OLD.id, OLD."workspaceId", OLD."mediaRoot") ON CONFLICT (id) DO NOTHING;
  RETURN OLD;
END $$;
CREATE TRIGGER rebuild_export_file_cleanup AFTER DELETE ON public.rebuild_workspace_exports
  FOR EACH ROW EXECUTE FUNCTION public.rebuild_queue_export_file_cleanup();
