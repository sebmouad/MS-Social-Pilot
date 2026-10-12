-- Developer features (API keys, MCP, outgoing webhooks) are off unless root
-- turns them on for a workspace.
ALTER TABLE "workspaces" ADD COLUMN "developerFeatures" BOOLEAN NOT NULL DEFAULT false;

-- Workspaces already using them keep them, so no integration stops overnight.
UPDATE "workspaces" SET "developerFeatures" = true
WHERE "id" IN (
  SELECT "workspaceId" FROM "api_tokens" WHERE "revokedAt" IS NULL
  UNION
  SELECT "workspaceId" FROM "webhook_endpoints"
);
