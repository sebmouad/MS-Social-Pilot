CREATE TABLE ads_management_operations (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  "adAccountId" TEXT NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL CHECK (length("requestId") BETWEEN 8 AND 128),
  "requestHash" CHAR(64) NOT NULL CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  "operationType" TEXT NOT NULL CHECK ("operationType" IN ('status.set','budget.set','rename','creative.assign','delete')),
  "objectType" TEXT NOT NULL CHECK ("objectType" IN ('campaign','adset','ad')),
  "objectId" TEXT NOT NULL,
  params JSONB NOT NULL CHECK (jsonb_typeof(params) = 'object'),
  status TEXT NOT NULL CHECK (status IN ('pending','succeeded','rejected','uncertain','resolved_applied','resolved_not_applied')),
  "remoteId" TEXT,
  "failureCode" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completedAt" TIMESTAMPTZ,
  "resolvedBy" TEXT,
  "resolvedAt" TIMESTAMPTZ,
  "resolutionNote" TEXT,
  CONSTRAINT ads_operations_resolution_shape CHECK (
    (status IN ('resolved_applied','resolved_not_applied')) = ("resolvedBy" IS NOT NULL AND "resolvedAt" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX ads_management_operations_actor_request
  ON ads_management_operations ("workspaceId", "actorId", "requestId");
CREATE UNIQUE INDEX ads_management_operations_open_object
  ON ads_management_operations ("workspaceId", "adAccountId", "objectType", "objectId")
  WHERE status IN ('pending','uncertain');
CREATE INDEX ads_management_operations_history
  ON ads_management_operations ("workspaceId", "adAccountId", "createdAt" DESC, id);
