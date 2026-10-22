-- Content-free transactional outbox. Transport claims commit before external I/O;
-- a lost claim becomes uncertain, never pending again.
CREATE UNIQUE INDEX chat_channels_id_workspace_id ON chat_channels(id, "workspaceId");

CREATE TABLE rebuild_chat_deliveries (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  "channelId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  event TEXT NOT NULL,
  source JSONB,
  "operatorOnly" BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','accepted','rejected','uncertain','cancelled')),
  "claimedAt" TIMESTAMP(3),
  "claimToken" TEXT,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("channelId", "workspaceId") REFERENCES chat_channels(id, "workspaceId") ON DELETE CASCADE,
  UNIQUE ("workspaceId", "channelId", "eventId", event)
);
CREATE INDEX rebuild_chat_deliveries_pending ON rebuild_chat_deliveries(status, "createdAt");

CREATE TRIGGER rebuild_workspace_purge_write_gate
  BEFORE INSERT OR UPDATE ON public.rebuild_chat_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_workspace_write();
