# Publishing post history

Post history snapshots are stored in the existing legacy-compatible `post_versions` table. The rebuild Prisma projection does not include this table, so the Publishing lifecycle uses parameterized SQL through `recordPostVersion(tx, postId, authorId, retention)`. The existing table has a cascading post foreign key and stores message, first comment, link, media, format, destination IDs, label IDs, scheduled time and timezone. No schema change is part of this work.

The lifecycle reads the validated Root setting `publishing.collab.versionRetention` once per operation. Create records the newly persisted post in its create transaction. Update records the current persisted post before mutation and the saved post after mutation; the helper skips a duplicate latest snapshot and prunes only after a new insert. Local draft create/edit and new duplicated drafts also record snapshots atomically; duplicate retries reuse their receipt and do not add history. Schedule, reschedule and local cancellation record the saved schedule in the same transaction as the status/time change. A failed snapshot, audit, or prune aborts the lifecycle transaction with its post mutation.

Restore reads a workspace-and-post-scoped snapshot in the collaboration service and releases that transaction before calling the lifecycle. The lifecycle then starts the ordinary guarded Publishing operation, rechecks membership, role, page scope and current destination authority, validates content and media against current platform support, and refuses scheduled, published, publishing, partially failed, or otherwise non-editable posts. It snapshots the current content, applies validated saved text, first comment, link, media and available formats to the current destinations through the regular save path, resets an approved post's review, replaces labels in that same transaction, and records the restored state. Missing labels or invalid destinations fail the transaction without a partial restore. A historical schedule is not replayed: restoring never schedules or publishes content.

`createdAt` for internal notes is returned by PostgreSQL `INSERT ... RETURNING` and is used for the immediate UI row. The browser no longer substitutes its own clock.

Choice-field management receives the live Root option-count and per-option length limits. It blocks review while the distinct non-empty options exceed either bound and explains the correction; the service remains authoritative.

## Host integration

`src/modules/publishing/server/collaboration.ts` installs the lifecycle restore port
idempotently, preserving other registered ports. Its lazy lifecycle import avoids
initialization cycles. Customer collaboration pages, the versions HTTP mutation
and MCP handler each call this host composition before capability discovery/use;
no route relies on another route having been visited first. Lookup/request audits
commit before the ordinary guarded lifecycle operation begins. Read-only MCP keys
cannot acquire write authority through this registration.

The restore dialog explicitly reviews content and consequences, sending the
exact domain confirmation only after the user chooses Restore version. It does
not require typing an opaque internal identifier for this reversible local edit.
Failure keeps the review open with feedback; success confirms the saved outcome.
Current schedule and timezone stay unchanged. The version-restore branch adds
neutral catalog validation and explicitly reviewed adaptation as described below;
this does not implement new provider formats.

## Ordering and retention

The legacy timestamp column has millisecond precision. PostgreSQL transaction
`NOW()` would give pre/post snapshots equal timestamps, letting random IDs choose
the newest version and retention victim. Inserts instead choose at least one
millisecond after the current per-post maximum, under the publishing operation's
post lock. Deduplication and pruning therefore follow save order even for a
burst of updates within one transaction. Retention and mutation share the same
transaction; a failed history write cannot leave a successful post edit.

## Verification and limits

The guarded `scripts/verify-publishing-history.ts` passed actual localhost
HTTP/MCP/PostgreSQL history, content/media/destination/label restoration, approval
reset, exact-confirmation/read-only/foreign-version/published-post refusals,
rapid ordering/deduplication and five-version retention without publication.
Both disposable workspaces and fixture/audit records were removed; exact prior
Root settings were restored and checked. Chrome created, edited and restored an
identifiable local draft, observed the success and newest saved content, then
deleted it and verified the history endpoint returned 404.

Component checks cover Root choice limits, authoritative note timestamps, and
restore failure/retry/success behavior. The final isolated batch passed 2,133 tests in 276 files and production build;
subsequent serial typecheck also passed. The strict static
UI audit has zero findings in changed collaboration owners and 32 elsewhere in
the whole working tree. Wider phone/theme/keyboard/offline and
revocation-concurrency coverage, all legacy workflows, native formats, real
Facebook operations, migration/rollback rehearsal and production cutover remain
open. Production remains legacy.


## Current-destination restore review (2026-10-20 branch batch)

`server/version-restore.ts` checks the current selected destinations, resource
scope, editability and credential grants under the lifecycle's post/destination
locks. `version-restore-plan.ts` interprets only validated neutral catalog
metadata: use the historical per-destination format if still available, otherwise
the current available format or module default. Historical destination IDs never
reappear. Existing format IDs remain opaque; no provider branches were added.

The proposal keeps an ordered compatible media subset and supported image
descriptions, omits missing local files and unsupported first comments, and
clamps a still-supported comment delay to the current Root ceiling (clears delay
when the comment is omitted). Unknown storage failures fail the operation rather
than silently losing attachments. A content-empty proposal cannot be applied.
Ordinary text/link/label limits and media checks still run before the atomic save;
no automatic truncation or deletion of unavailable labels is promised.

HTTP POST `/api/publishing/versions` and MCP `restore_post_version` accept
`mode: preview | exact | closest` and optional `reviewToken`, with the existing
exact `RESTORE VERSION <versionId>` confirmation. Preview returns `restored:
false`, `status: review_required`, and `review` with `exact`, `canRestore`, en/fr
`issues`, safe destination names/format labels, proposed `content` and `token`.
Default/exact writes return that review without mutation when adaptation is
needed. Closest requires the matching token; the proposal is recalculated under
locks before every save. No restored audit is emitted for a preview/refusal.
The UI reviews first, offers Restore closest valid version only explicitly,
confirms through shared `useConfirm`, and keeps failures reviewable with a
Review again action. Normal history retention and approval reset remain atomic.

No Root keys, registry edit, migration, server execution, push or deployment.
Evidence for this branch: mocked service, catalog algorithm, UI DOM and
HTTP/MCP delegation checks; the real HTTP/PostgreSQL/browser evidence above
belongs to the earlier restore implementation and does not verify this change.
Actual PostgreSQL/concurrency, real browser themes/viewports/keyboard and
live-provider/MCP transport verification remain open.

Final branch checks from `rebuild/`: `npx vitest run
 tests/version-restore-plan.test.ts tests/version-restore-service.test.ts
 tests/publishing-*.test.ts tests/destination-formats-ui.test.ts
 tests/raw-sql-void-guard.test.ts` passed 391 tests in 44 files; 12 database
integration tests in 3 files skipped because their opt-in database environment
was not configured. `npx tsc --noEmit -p .` and `git diff --check` passed.
