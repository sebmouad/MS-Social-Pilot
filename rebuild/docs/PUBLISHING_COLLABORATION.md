# Publishing collaboration (W1)

Status: batch 67 integrates bulk labels, custom fields, internal notes and stored history reads with Root configuration, customer navigation, HTTP and workspace MCP. Guarded local HTTP/MCP/PostgreSQL proof and phone custom-field creation/deletion passed. Queue scheduling, content mix, recycling, version recording/restore and mention delivery remain unintegrated; production/provider evidence is absent.
Contract: [ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md). Inventory: [LEGACY_CAPABILITY_PARITY.md](LEGACY_CAPABILITY_PARITY.md).

## What exists

Provider-neutral services in `src/modules/publishing/collaboration/server/` over the existing legacy tables
(`post_labels`, `custom_fields`, `post_field_values`, `post_notes`, `post_versions`, `queue_slots`,
`content_mix_rules`, `posts.recycle*`/`variants`). Every mutation is one workspace-locked transaction that re-reads
membership/user authority, checks whole-post visibility (same rule as duplicate/read), writes, and inserts an
`activity_logs` row; each requires an exact confirmation string. UI, API and MCP are thin over these services.

| Capability | Service | Who may write |
| --- | --- | --- |
| Per-post and bulk labels (add/remove/set, atomic, limits) | `assignments.ts`, `post-list.ts` | editor+ any visible post; contributor own posts |
| Custom field definitions | `custom-fields.ts` | owner/admin with access to all channels |
| Per-post field values | `custom-fields.ts` | as labels |
| Internal notes with mentions | `notes.ts` | any writer on a visible post; delete: author or editor+ |
| Version history list/restore request | `versions.ts` | as labels; restore needs lifecycle port |
| Queue times | `queue-slots.ts` | owner/admin; shared timetable also needs all channels |
| Content mix | `content-mix.ts` | owner/admin; group rules also need all channels |
| Recycle rules | `recycle.ts` | as labels; alternate wordings need editor+ when approvals are required |

Other files: `config.ts` (24 Root settings `publishing.collab.*`), `schemas.ts` (pure contracts, confirmations,
`nextRecycleAt`, `effectiveMix`), `ports.ts`, `mcp.ts`, `http.ts`. Routes: `/api/publishing/{assignments,custom-fields,
custom-fields/[id],custom-fields/posts/[postId],notes,notes/[id],versions,queue-slots,content-mix,recycle}`.
Screens: `/publishing/collaboration?view=assign|fields|queue|mix` and `/publishing/collaboration/post/[postId]`.

## Host wiring and remaining integration

1. **Root registry**: registry 61 installs `COLLAB_CONFIG`, owned by Publishing. Bounds for active metadata workflows are consumed; execution-policy controls are explicitly `planned` until workers/lifecycle hooks exist.
2. **MCP**: host metadata, scoped dispatch, write handling and field-directory resource are installed. Port-dependent tools are absent from discovery and direct calls are refused. Complete read results exceeding the MCP ceiling are refused; mutation selections are checked before dispatch.
3. **Navigation**: the Publishing manifest declares Organize and Posts actions link to post organization only when permitted. Subviews and search use the existing contextual sidebar/drawer. Post notes/history expose separate pagination links. Label association choices are complete within the Root workspace ceiling, independent of directory pagination.
4. **Startup**: call `registerCollaborationPorts({ versions, recycle: RECYCLE_EXECUTOR, queue: QUEUE_SCHEDULER, mix: MIX_EXECUTOR, mentions })`
   (the three markers are exported by `server/executors.ts`). Register each ONLY after its wiring below exists. Until then: restore, recycle,
   queue times and content mix are absent from the customer screens (nav entries, post sections), API routes and MCP tools; the version
   history section is shown only when versions exist or restore is registered.
5. **Entitlements/permissions**: `publishing/collaboration` inherits the existing Posts plan/module grant while retaining an independent installation feature switch. Metadata services, UI, HTTP and MCP recheck it. Queue times/content mix use `publishing/queue`, with their ports still unregistered.

## Lifecycle integration port (`server/publishing/lifecycle.ts`, reserved)

`VersionRestorePort.restorePostVersion({ actor, postId, snapshot })` must apply the snapshot as an ordinary save:
re-validate content, destinations (availability, selection, scope), media and first comment; reset approval where an edit
would; refuse non-editable states; take the same per-target locks; record a new version of the pre-restore state;
return `{ postId, status, approvalReset }`. Collaboration only authorizes the caller, locks the post, verifies the version
belongs to the post/workspace, rejects final states (`published`, `publishing`, `partially_failed`, `cancelled`, `rejected`)
and audits request and outcome. It never updates `posts` content itself.

Also required of the lifecycle: call `recordPostVersion(tx, postId, authorId, retention)` (exported from `server/versions.ts`)
inside every create/update transaction, with `retention = runtimeConfig('publishing.collab.versionRetention')`. It skips unchanged saves and prunes.
Without this, history stays empty. Rebuild currently writes no versions.

`RecycleExecutorPort` signals that a worker actually creates repeats: for each `posts` row with `recycleEnabled` and
`recycleNextAt <= now`, claim by compare-and-set on `recycleNextAt`, clone as `originPostId` copy with the next variant,
increment `recycleCount`, advance via `nextRecycleAt({ ..., now })`, stop at `recycleLimit`, audit. No such worker exists in rebuild;
until one is registered the recycle UI/MCP/API refuse. Likewise no rebuild worker consumes `content_mix_rules` or
`queue_slots`: the lifecycle queue allocator must read `queue_slots` (channel rows, else shared) and the worker must implement
auto-fill from `content_mix_rules` (legacy `runContentMix`, gated by `workspaces.mixAutoFill`, which belongs to workspace policy).
Saving times/rules works and is audited, but they have no scheduling effect in the rebuild until those consumers exist.

`MentionNotifierPort.notifyNoteMention` delivers mention notices after commit. Failure is reported (`notified: 'failed'`) and never rolls back the note.

## Module-owned executors (`server/executors.ts`, review-and-fix R1)

Pure, tested services the shared worker and lifecycle call. Nothing runs by itself.

- `runRecycleCycle({ now?, eligible? })`: batch size from `publishing.collab.executorBatchSize`. Per due post, one workspace transaction
  (advisory lock + `FOR UPDATE SKIP LOCKED`): re-checks due/enabled/status under the lock, stops posts with no active destination, claims by
  compare-and-set on `recycleNextAt`, inserts the copy with deterministic id `rc_<postId>_<run>` (`ON CONFLICT DO NOTHING`, so a retry cannot
  duplicate), copies destinations, audits with a null actor. Copies are `scheduled`, `not_required` approval, `originPostId` set; they also copy
  format and first comment (legacy omitted both). `eligible(workspaceId)` is the host's owner/plan/module gate.
- `runContentMix({ now?, eligible?, notify? })`: per workspace transaction; fills shortfalls from ready drafts (approved, or not_required for a
  non-contributor/unrestricted workspace; all destinations active) only when `workspaces."mixAutoFill"`; each draft is one CAS update
  (`status = 'draft'`) into a distinct free queue time inside the mix window; "ran dry" is claimed with `dryNotifiedAt IS NULL` and
  `notify` is called after commit (failure ignored, claim stays). Seasonal queue modes are not ported.
- `allocateQueueTime(tx, workspaceId, timeZone, targetIds, now?, horizonDays?)`, `nextAvailableSlot`, `slotsForPages`, `wallToUtc`
  (DST-aware, nonexistent local times skipped): for lifecycle queue allocation. Caller must hold the workspace advisory lock
  (`pg_advisory_xact_lock(hashtext(workspaceId))`) in the same transaction that writes the post, with a status in
  `scheduled|pending_approval|publishing`.
- New Root settings: `publishing.collab.executorBatchSize`, `publishing.collab.queueLookaheadDays` (spread `COLLAB_CONFIG`; now 26 entries).

### Exact minimal patch spec for reserved files

`server/publishing/lifecycle.ts` (lead applies; collaboration does not edit it):
1. `import { recordPostVersion } from '@/modules/publishing/collaboration/server/versions'` and `bounds` from `.../server/core`; read
   `versionRetention` via `runtimeConfig('publishing.collab.versionRetention')` once per operation.
2. Inside the `publishingTransaction` callbacks of `createPost` (after the label insert), `updatePost` (after `tx.post.update` and the approval
   reset), `schedulePost` (after the status update) and `reschedulePost`: `await recordPostVersion(tx, id, actor.userId, retention)`.
   (It is a no-op when nothing changed.) Note rebuild `createPost` does not store `format`/`timezone`; versions record the column defaults.
3. Implement `VersionRestorePort.restorePostVersion` as a thin wrapper: `updatePost` with the snapshot's message, firstComment, link, media and
   `targetIds` (re-validated), then replace labels with `snapshot.labelIds` that still exist in the workspace (same transaction), and report
   `approvalReset` from the guarded approval update. `updatePost` already refuses scheduled/published posts, so restore applies to drafts and
   rejected posts only; restoring a scheduled time is out of scope until a reschedule path is chosen.
4. Queue scheduling: add a `queuePost` path that, inside `publishingTransaction`, takes the workspace advisory lock, calls
   `allocateQueueTime(tx, workspaceId, workspaceTimeZone, targetIds)`, and sets `scheduled`/`pending_approval` with that time (error when null).
   Then register `QUEUE_SCHEDULER`.
Worker (shared jobs): call `runRecycleCycle` and `runContentMix` on their schedule with `eligible` = the owner-qualification policy, then
register `RECYCLE_EXECUTOR` and `MIX_EXECUTOR`. Mention notices: implement `MentionNotifierPort`.

## Schema notes

No migration proposed. Assumed present in the production-shaped schema (legacy migrations): the tables above,
`queue_slots."targetId"`, `memberships."allPages"`, `member_page_access`, `page_groups`, `page_group_targets`,
`workspaces."requiresApproval"`, `posts.format/timezone/variants/recycle*/originPostId/approvalStatus`. The rebuild Prisma projection lacks these, so SQL is raw and parameterized.
Verify on the migrated/preview database; the unit tests mock SQL and do not prove column names.

## Known limitations and open proof

- Tests (49 + 15 executor, mocked database) prove authorization branches, isolation, confirmations, atomic/audit boundaries and route/MCP contracts only.
- Executors are unproven against PostgreSQL: the INSERT ... SELECT-free copy, `HAVING ARRAY_AGG(..) && ..::text[]`, enum casts (`"PostStatus"`, `"PublishMode"`, `"ApprovalStatus"`) and `FOR UPDATE SKIP LOCKED` need a run on the migrated schema. Column names were checked by reading prisma/schema.prisma only.
- Not verified: real PostgreSQL behavior (array params, `ON CONFLICT`, `gen_random_uuid`, enum casts), browsers/phone/themes, keyboard flows.
- Mention candidate list excludes `client` role and disabled users; email/in-app delivery depends on the port.
- Contributors see only their own posts here (same rule as duplicate); editors+ see every visible post.
- Post list for bulk labels is a separate simple query (no status/date/channel filters yet); labels are workspace-wide so assignment is not channel-restricted.
- No CSV import of fields/labels, no field filter on Posts, no field/label columns in exports, and no composer integration (labels/fields on the compose form): composer and posts table are reserved.
- Content-mix "ready drafts" approximates the worker's auto-schedule eligibility from approval status and author role.
- Legacy label report, per-label reporting and seasonal queue modes are out of this slice.

## Lead integration review — batch 66

The draft worker authorization default was unsafe: missing eligibility callbacks allowed work, and recycling cached a workspace grant across later posts. Both executors now refuse before database access when the owner-qualification port is absent; recycling checks each item rather than reusing an earlier grant. Three regressions failed against the original implementation and pass after the change. The 68 focused service/contract/executor tests use mocks; they do not prove database concurrency or provider delivery.

Keep all execution ports unregistered until current owner/plan/module/resource checks are connected and verified at the transaction/dispatch boundaries. Review still open: contributor variant approval on recycled copies, current selected/connected destination enforcement, transactional policy rechecks, missing version lifecycle hooks, report/export/erasure coverage, bounded mention directory, strict UI query handling, and real PostgreSQL/browser/MCP host evidence. This source batch does not advertise or enable scheduling.

## Batch 67 integration and evidence

The guarded script `scripts/verify-publishing-collaboration.ts` passed actual local HTTP/MCP/PostgreSQL CRUD, confirmations, stored results, foreign-post denial, read-only key denial, feature-disable denial, note pagination and malformed cross-tenant cascade refusal. It restores exact setting rows, disposable fixtures, keys and audits and verifies cleanup. No provider API or production data was used.

Chrome verified desktop layout and phone 390px custom-field review/create/delete with exact confirmation and cleanup. The phone dialog measured 352px; document/visual widths remained 390px. A component regression verifies an offline error is focused inside the active review dialog, preserves confirmation and succeeds on retry. Mention notification choices remain hidden until a real delivery port exists. UI malformed/repeated filters are refused rather than silently clipped/defaulted. Input outer ceilings derive from the registry declarations; services still enforce live Root limits.

Execution/restore hooks, real multi-user concurrency, broader theme/keyboard coverage, export/erasure behavioral proof and remaining legacy collaboration capabilities remain open. These checks establish the stated metadata workflows, not completion of Publishing or the rebuild.

MCP label parity additionally includes `get_post_labels` and `list_post_label_choices` (Root page size intersected with the current MCP ceiling), so an organization-scoped key can discover usable associations without a separate directory permission. Notes and saved versions use the current workspace time zone in the UI. Plain notes do not query an unused notification roster.


## Batch 71 host status

Saved queue times and guarded post placement are integrated through
`server/publishing/queue.ts`, the Posts review action, HTTP and authenticated
workspace MCP. Root registry 64 activates timetable/lookahead policies and the
editor's default slot. See PUBLISHING_QUEUE.md for current authority, lock,
approval, concurrency, UX and actual proof boundaries. Content mix/recycle
execution remains unregistered and hidden; the source-only executor notes above
must not be read as delivered worker integration. See CUTOVER.md for the local
interrupted-probe recovery incident and controlled preview baseline.
