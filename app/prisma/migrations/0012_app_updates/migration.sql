-- Updates the app records (a GitHub push to the deployed branch, or Root › Updates › Update now) and the server's
-- updater (app/scripts/updater.sh, run by social-pilot-updater.timer as root) carries out one at a time.
-- `commit` is null when the branch head at run time is wanted. Idempotent.
CREATE TABLE IF NOT EXISTS app_updates (
  id TEXT PRIMARY KEY,
  "commit" TEXT,
  branch TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('github', 'root')),
  status TEXT NOT NULL CHECK (status IN ('requested', 'running', 'succeeded', 'failed', 'superseded')),
  "requestedBy" TEXT,
  summary TEXT,
  "deployedCommit" TEXT,
  log TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "startedAt" TIMESTAMPTZ,
  "finishedAt" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS app_updates_status_created ON app_updates (status, "createdAt");
CREATE INDEX IF NOT EXISTS app_updates_created ON app_updates ("createdAt");
