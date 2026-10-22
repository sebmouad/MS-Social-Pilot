-- Optional-area activation for Tasks (design v2 B7 leftover, lane 56; 01 section 4):
-- a workspace owner can show the Tasks area in Settings › Workspace before the
-- workspace has any task. Additive nullable-safe column: existing rows read as
-- not activated, and the area still appears once the workspace has a task.

ALTER TABLE "workspaces" ADD COLUMN "tasksAreaEnabled" BOOLEAN NOT NULL DEFAULT false;
