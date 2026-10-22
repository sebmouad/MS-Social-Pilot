CREATE TABLE "mcp_api_keys" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "readFeatures" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "writeFeatures" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "mcp_api_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mcp_api_keys_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mcp_api_keys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mcp_api_keys_tokenHash_key" ON "mcp_api_keys"("tokenHash");
CREATE INDEX "mcp_api_keys_workspaceId_createdAt_idx" ON "mcp_api_keys"("workspaceId", "createdAt");
CREATE INDEX "mcp_api_keys_expiresAt_idx" ON "mcp_api_keys"("expiresAt");
