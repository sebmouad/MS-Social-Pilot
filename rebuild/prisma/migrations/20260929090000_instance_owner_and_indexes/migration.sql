-- Instance-wide configuration used to be gated on "owner of the active
-- workspace", and everybody who registers owns a workspace of their own. The
-- flag names the one person who installed the server instead.
ALTER TABLE "users" ADD COLUMN     "isInstanceOwner" BOOLEAN NOT NULL DEFAULT false;

-- An existing installation keeps working: the owner of the oldest workspace is
-- the person who set it up, and failing that (no workspace at all) the oldest
-- account. Exactly one row, so this never promotes a second person.
UPDATE "users" SET "isInstanceOwner" = true
WHERE "id" = COALESCE(
  (
    SELECT m."userId"
    FROM "memberships" m
    JOIN "workspaces" w ON w."id" = m."workspaceId"
    WHERE m."role" = 'owner'
    ORDER BY w."createdAt" ASC, m."createdAt" ASC
    LIMIT 1
  ),
  (SELECT "id" FROM "users" ORDER BY "createdAt" ASC LIMIT 1)
);

-- Invitations are looked up by address at sign-up, across workspaces.
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- The media library lists newest first within a workspace.
CREATE INDEX "media_workspaceId_createdAt_idx" ON "media"("workspaceId", "createdAt");

-- The insights sync picks published targets by how long ago they were read.
CREATE INDEX "post_targets_status_insightsSyncedAt_idx" ON "post_targets"("status", "insightsSyncedAt");

-- The calendar and the queue read a workspace's posts by date.
CREATE INDEX "posts_workspaceId_scheduledAt_idx" ON "posts"("workspaceId", "scheduledAt");

-- Foreign keys Postgres does not index on its own; without these, deleting a
-- user, a recycled original or a feed item scans every post.
CREATE INDEX "posts_authorId_idx" ON "posts"("authorId");

CREATE INDEX "posts_originPostId_idx" ON "posts"("originPostId");

CREATE INDEX "posts_sourceFeedItemId_idx" ON "posts"("sourceFeedItemId");
