-- A read-only member: sees its channels, changes nothing.
ALTER TYPE "WorkspaceRole" ADD VALUE IF NOT EXISTS 'viewer';
