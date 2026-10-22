CREATE TABLE rebuild_post_exports (
 id text PRIMARY KEY, "workspaceId" text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 "userId" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 filters jsonb NOT NULL, ceiling jsonb NOT NULL, scope text NOT NULL,
 status text NOT NULL CHECK (status IN ('queued','processing','ready','failed')),
 "expiresAt" timestamptz NOT NULL, "leaseUntil" timestamptz, token text, csv text,
 attempts integer NOT NULL DEFAULT 0, "nextAttemptAt" timestamptz NOT NULL DEFAULT now(),
 "lastError" text, "completedAt" timestamptz,
 "createdAt" timestamptz NOT NULL DEFAULT now(), UNIQUE (id, "workspaceId", "userId")
);
CREATE INDEX ON rebuild_post_exports (status, "nextAttemptAt", "createdAt");
CREATE TABLE rebuild_post_export_runs (
 id text PRIMARY KEY, "exportId" text NOT NULL REFERENCES rebuild_post_exports(id) ON DELETE CASCADE,
 "workspaceId" text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 "userId" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 attempt integer NOT NULL, outcome text NOT NULL CHECK (outcome IN ('running','succeeded','retry','failed','expired')),
 "errorCode" text, "startedAt" timestamptz NOT NULL DEFAULT now(), "finishedAt" timestamptz,
 "postCount" integer, "byteLength" integer, UNIQUE ("exportId", attempt),
 FOREIGN KEY ("exportId", "workspaceId", "userId") REFERENCES rebuild_post_exports(id, "workspaceId", "userId") ON DELETE CASCADE
);
CREATE INDEX ON rebuild_post_export_runs ("workspaceId", "exportId", attempt);
