-- Task comments for the rebuild Tasks module. Additive: one new table and one
-- unique index on the existing tasks table. Existing rows are not rewritten.
--
-- Workspace boundary: a comment's (taskId, workspaceId) must name an existing
-- task of that same workspace. The composite foreign key makes a cross-workspace
-- comment unrepresentable, whatever code path writes it.
-- Lifecycle:
--   * deleting a task or its workspace deletes the comments (ON DELETE CASCADE),
--     so workspace erasure and exports need no table-specific handling;
--   * deleting a user keeps the comment but clears the author (ON DELETE SET NULL),
--     which the app shows as "Former member".

-- Target of the composite foreign key. "id" is already the primary key, so this
-- cannot fail on existing data; it only adds the (id, workspaceId) lookup.
CREATE UNIQUE INDEX "tasks_id_workspaceId_key" ON "tasks"("id", "workspaceId");

CREATE TABLE "task_comments" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "authorId" TEXT,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id"),
  -- Ceiling matches the largest value Root may configure for tasks.commentMaxCharacters.
  CONSTRAINT "task_comments_body_check" CHECK (char_length(btrim("body")) > 0 AND char_length("body") <= 20000)
);

-- Ordered comment history of one task, and the author lookup used by SET NULL.
CREATE INDEX "task_comments_taskId_createdAt_id_idx" ON "task_comments"("taskId", "createdAt", "id");
CREATE INDEX "task_comments_workspaceId_idx" ON "task_comments"("workspaceId");
CREATE INDEX "task_comments_authorId_idx" ON "task_comments"("authorId");

ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_fkey"
  FOREIGN KEY ("taskId", "workspaceId") REFERENCES "tasks"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The earlier workspace_data_purges migration installed this write gate on every
-- workspace-owned table that existed then. New tables must join it, otherwise a
-- comment could be written while the workspace is being erased.
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "task_comments"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
