-- Workspace branding only. Originals and legacy per-channel watermark JSON are untouched.
CREATE TABLE rebuild_workspace_watermarks (
  "workspaceId" text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  logo bytea NOT NULL,
  position text NOT NULL CHECK (position IN ('northwest', 'northeast', 'center', 'southwest', 'southeast')),
  opacity double precision NOT NULL CHECK (opacity >= 0 AND opacity <= 1),
  scale double precision NOT NULL CHECK (scale >= 0.01 AND scale <= 1)
);
CREATE TRIGGER rebuild_workspace_watermarks_purge_gate
BEFORE INSERT OR UPDATE ON rebuild_workspace_watermarks
FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_workspace_write();
