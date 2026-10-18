# Tasks integration and Agency inventory

## Tasks — batch 76, locally verified

Tasks is a registered product module at `/tasks`, with its own manifest, services,
UI, HTTP routes, ten MCP tools and `msp://tasks` resource. Registry version 69
registers eleven Tasks bounds. Root owns its module and feature settings; stored
workspace/member Tasks disable switches are enforced. Dedicated Root editing UI
for those per-member/workspace switches remains incomplete.

Table is default; Board is selectable from contextual sidebar filters. Tasks
support assignees, workspace-calendar due dates, arbitrary status transitions,
optimistic edits, deletion with a consequence checkbox, linked posts, paged
comments and atomic checklist creation with date gaps. Contributor edits are
limited to created/assigned tasks; deletion to created tasks. Clients are denied.
Current memberships and workspace state are locked/rechecked before writes.
Linked previews require current Publishing visibility and MCP key permissions;
resource ceilings and result bounds apply to every collection. Audits omit text.

Tasks uses raw SQL against existing tasks and the new task_comments table;
rebuild Prisma models are not the service persistence contract. The comments
migration enforces same-workspace links, content bounds and cascades. A separate
prerequisite reconciles existing workspace purge guards. Workspace erasure now
orders children before parents from actual FK dependencies; cycles fail closed,
and purge triggers remain enabled.

## Verified evidence

- Isolated integration snapshot: 2,428 tests / 298 files, zero skips; production
  build passed. Serial typecheck is recorded in the shared handoff when complete.
- Seven real PostgreSQL tests: composite FK, content checks, cascades and purge
  guards. Twenty-seven targeted data-control tests cover deletion ordering,
  existing lifecycle and archives.
- Guarded local HTTP/MCP/PostgreSQL probe passed task/comment/edit/checklist,
  stale conflicts, key permission/resource/result ceilings, foreign refusals,
  export contents and complete disposable-workspace erasure. Captured settings
  and fixtures were restored; a foreign workspace remained intact.
- Fresh private preview backup was scratch-restored before local migration;
  counts for 103 original tables and settings digest were preserved. All thirteen
  checksum-pinned migrations passed a separate schema-only rehearsal. This is
  not production customer-data/media/service rollback evidence.
- Phone browser verified actual create/comment/edit/delete and checkbox refusal,
  with temporary content removed. A bottom-navigation overlap was reproduced
  and fixed through shared scroll clearance. Page width remained 390px with
  table-local scrolling. Board, full keyboard and all-theme mutation coverage
  are not yet established. Four realistic example tasks intentionally remain.

## Remaining Tasks limitations

Bounded assignee choices lack complete browse/search pagination. Offset paging
can repeat or omit rows during concurrent edits. Plan/installation entitlements
are checked before the transaction rather than locked inside it. Search length,
preview length and offset ceilings remain source constants, so full Root technical
configuration coverage is not achieved. Reminders, recurrence, activity UI,
comment editing and drag/drop are absent. These are not claimed legacy features.
Production-shaped authorization/concurrency and release evidence remain open.

## Agency — source only, unavailable

Prepared Agency source aggregates administered workspaces and client invitations.
It is not registered in navigation, configuration or MCP and has no integrated
browser/database proof. Its cross-workspace reads need entitlement checks and
an authority model that cannot leak through workspace-scoped MCP keys. Do not
expose it until those boundaries and tests are implemented. Agency remains a
separate unfinished batch; source presence is not capability completion.
