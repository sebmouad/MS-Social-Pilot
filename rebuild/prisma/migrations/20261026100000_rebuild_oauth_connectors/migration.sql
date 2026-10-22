-- OAuth connectors for MCP clients (dynamic client registration + authorization code with PKCE).
-- Additive only: two new tables, no change to existing tables. Replaces the legacy "OAuthClient"/"OAuthCode"
-- tables, which stay untouched until cutover cleanup. Codes are stored only as SHA-256 hashes; the access
-- token is an ordinary scoped mcp_api_keys row created at token exchange (referenced by keyId for reuse revocation).

CREATE TABLE "mcp_oauth_clients" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "redirectUris" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "mcp_oauth_clients_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mcp_oauth_clients_name_length" CHECK (char_length("name") BETWEEN 1 AND 60),
  CONSTRAINT "mcp_oauth_clients_redirects" CHECK (cardinality("redirectUris") BETWEEN 1 AND 10)
);

CREATE TABLE "mcp_oauth_codes" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "codeChallenge" TEXT NOT NULL,
  "readFeatures" TEXT[] NOT NULL,
  "writeFeatures" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "resourceScope" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "keyId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mcp_oauth_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mcp_oauth_codes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "mcp_oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mcp_oauth_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mcp_oauth_codes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mcp_oauth_codes_challenge_shape" CHECK ("codeChallenge" ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT "mcp_oauth_codes_write_within_read" CHECK ("writeFeatures" <@ "readFeatures")
);
CREATE UNIQUE INDEX "mcp_oauth_codes_codeHash_key" ON "mcp_oauth_codes"("codeHash");
CREATE INDEX "mcp_oauth_codes_clientId_idx" ON "mcp_oauth_codes"("clientId");
CREATE INDEX "mcp_oauth_codes_expiresAt_idx" ON "mcp_oauth_codes"("expiresAt");
CREATE INDEX "mcp_oauth_clients_createdAt_idx" ON "mcp_oauth_clients"("createdAt");
