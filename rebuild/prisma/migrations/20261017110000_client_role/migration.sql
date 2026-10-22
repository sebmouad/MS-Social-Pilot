-- The agency's customer as a member: sees calendar and approvals, plus what the workspace opens to clients.
ALTER TYPE "WorkspaceRole" ADD VALUE IF NOT EXISTS 'client';

ALTER TABLE "workspaces" ADD COLUMN "clientAccess" TEXT[] DEFAULT ARRAY['analytics']::TEXT[];
