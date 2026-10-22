-- Integrator: wrap in a versioned migration; no runtime DDL.
CREATE TABLE rebuild_writing_agents (
 id text PRIMARY KEY, "workspaceId" text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 name text NOT NULL, instructions text NOT NULL, voice text NOT NULL,
 UNIQUE (id, "workspaceId"),
 "createdById" text NOT NULL REFERENCES users(id), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON rebuild_writing_agents ("workspaceId", id);
CREATE TABLE rebuild_writing_agent_runs (
 id text PRIMARY KEY, "workspaceId" text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 "agentId" text,
 FOREIGN KEY ("agentId", "workspaceId") REFERENCES rebuild_writing_agents(id, "workspaceId") ON DELETE SET NULL ("agentId"),
 "createdById" text NOT NULL REFERENCES users(id), kind text NOT NULL CHECK (kind IN ('post', 'reply')),
 status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')), "errorCode" text,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "completedAt" timestamptz
);
CREATE INDEX ON rebuild_writing_agent_runs ("workspaceId", "createdAt" DESC, id);
