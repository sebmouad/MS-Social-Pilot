-- Separate person-only credentials: no workspace or write grants can be stored.
CREATE TABLE person_mcp_keys (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "tokenPrefix" TEXT NOT NULL,
  "readFeature" TEXT NOT NULL DEFAULT 'agency/overview' CHECK ("readFeature" = 'agency/overview'),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("expiresAt" > "createdAt")
);
CREATE INDEX person_mcp_keys_user_active ON person_mcp_keys ("userId", "expiresAt") WHERE "revokedAt" IS NULL;
