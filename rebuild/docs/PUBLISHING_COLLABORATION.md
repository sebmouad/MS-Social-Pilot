# Publishing collaboration

Current status: batches 67–72 integrate organization, retained history/restore,
queue times and lifecycle-safe mix/recycling with UI, HTTP, authenticated workspace
MCP and Root configuration. These local implementations do not prove complete
legacy parity, live provider delivery or production readiness. Earlier source-only
integration notes remain in Git history; they must not be mistaken for current ports.

## Owners and entry points

`src/modules/publishing/collaboration/` owns schemas, limits, metadata, read/write
services and automation candidate selection. Thin customer/API/MCP entry points
use those services. `src/modules/publishing/server/collaboration.ts` independently installs
real lifecycle/worker ports in each server bundle. Missing ports remain hidden or
refused; one route never relies on another route having initialized it first.

| Workflow | Domain owner | Evidence and limits |
| --- | --- | --- |
| Bulk label association and complete label choices | server/assignments.ts, label-choices.ts | Scoped UI/HTTP/MCP; see PUBLISHING_LABELS.md |
| Custom field definitions/values | server/custom-fields.ts | Typed bounds, tenant/cascade checks and phone CRUD proof |
| Private notes | server/notes.ts | Author/manager mutation rules, bounded pagination; mention notification delivery remains hidden |
| Retained history/content restore | server/versions.ts plus Publishing lifecycle | Transactional versions and confirmed restore; PUBLISHING_HISTORY.md |
| Shared/channel queue timetables and placement | server/queue-slots.ts, server/executors.ts plus modules/publishing/server/queue.ts | PUBLISHING_QUEUE.md |
| Mix rules, workspace opt-in and repeating | server/content-mix.ts, recycle.ts, executors.ts plus modules/publishing/server/automation.ts | PUBLISHING_AUTOMATION.md |

Customer routes use `/publishing/collaboration?view=assign|fields|queue|mix` and
`/publishing/collaboration/post/[postId]`. Sidebar context owns route/scope pickers.
Organization/history/recycle use the collaboration feature, inheriting the Posts
plan/module grant with their own installation switch. Queue/mix use queue access.
Services recheck actual permissions and complete destination scope independently.
Shared/workspace-wide controls require all-channel owner/admin standing.

## Persistence and safety

Legacy tables are reused through parameterized SQL where the simplified rebuild
Prisma projection omits fields. This includes labels/post_labels, custom fields,
post notes/versions, queue slots, content-mix rules, workspace approval/autofill and
post recycle/approval/origin metadata. No new schema belongs to batches 67–72.

Current authorization, tenant ownership, resource scope and transactional audit
apply to writes. Publishing transitions additionally use its post/destination,
selected-resource and workspace guards and canonical content/media/approval rules.
Automation retains the real original author's current permission; current owner
qualification is additional authority, never an impersonated owner actor.
System transitions have system audit attribution. See the workflow documents for
exact lock/CAS/approval semantics and known limitations.

## Remaining work

Mention and dry-notice delivery, comprehensive collaboration export/erasure
coverage, large-workspace bounds, complete composer queue mode, native/cross-format
history, broader stale/offline/theme/keyboard/route-leave states and production-shaped
multi-worker/rollback evidence remain open. Facebook live media cleanup remains
held separately. (Written pre-cutover; production now runs this rebuild.) The full
ARCHITECTURE_CONTRACT.md and LEGACY_CAPABILITY_PARITY.md still govern completion.
