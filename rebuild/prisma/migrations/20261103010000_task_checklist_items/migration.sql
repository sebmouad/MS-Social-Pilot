-- Per-task checklist items for the Tasks module (design v2 B7 leftover, lane 56).
-- Additive: one new table. Existing rows are not rewritten.
--
-- Workspace boundary: an item's (taskId, workspaceId) must name an existing
-- task of that same workspace. The composite foreign key makes a cross-workspace
-- item unrepresentable, whatever code path writes it.
-- Lifecycle:
--   * deleting a task or its workspace deletes the items (ON DELETE CASCADE),
--     so workspace erasure and exports need no table-specific handling;
--   * deleting a user keeps the item but clears the author (ON DELETE SET NULL).

CREATE TABLE "task_checklist_items" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "done" BOOLEAN NOT NULL DEFAULT false,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_checklist_items_pkey" PRIMARY KEY ("id"),
  -- Ceiling matches the largest value Root may configure for tasks.checklistItemMaxCharacters.
  CONSTRAINT "task_checklist_items_text_check" CHECK (char_length(btrim("text")) > 0 AND char_length("text") <= 20000)
);

-- Ordered checklist of one task, and the author lookup used by SET NULL.
CREATE INDEX "task_checklist_items_taskId_position_id_idx" ON "task_checklist_items"("taskId", "position", "id");
CREATE INDEX "task_checklist_items_workspaceId_idx" ON "task_checklist_items"("workspaceId");
CREATE INDEX "task_checklist_items_createdById_idx" ON "task_checklist_items"("createdById");

ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_fkey"
  FOREIGN KEY ("taskId", "workspaceId") REFERENCES "tasks"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- New tables must join the workspace purge write gate, otherwise an item could
-- be written while the workspace is being erased.
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "task_checklist_items"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
