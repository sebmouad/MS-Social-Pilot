# Publishing post deletion recovery

Status: durable local intent and operator recovery are implemented in the
rebuild; provider behavior and release readiness remain unverified. Updated
2026-10-16.

## Ownership and behavior

`src/modules/publishing/server/deletion.ts` owns the workspace-scoped deletion
service, receipt state, alias retention, local finalization, and audit writes.
The selected platform adapter performs only the provider request. UI and
workspace MCP call the same service for remote deletion, status, manual outcome
recording, and finishing local removal. A deletion request can cover several
destinations; its receipt reports each remote identity and the overall local
state independently.

Before dispatch, the service commits a content-free row in
`rebuild_post_deletions`. A transport or provider exception leaves the attempt
`uncertain`; the service does not infer rejection from an error and does not
automatically retry it. A confirmed adapter response is committed as
`remote_confirmed` before any local cleanup. If some destinations succeed and a
later one fails, the committed per-destination evidence remains and the receipt
reports partial progress. The local post and references are removed only after
all required remote identities have persisted confirmation. The application
does not query the provider to automatically verify an uncertain request.

Installation-owner Root UI, HTTP, and private Root MCP expose bounded recent
history and an explicit external-attestation action. Workspace members can
inspect their own deletion receipt and use a verified outcome flow where their
role permits it. These actions record what a human checked on the platform;
they do not contact or automatically verify the provider. A late in-flight
request may still take effect after an attestation. Exact confirmations and
audit rows make that distinction visible.

The journal stores remote identity and local post/destination aliases, not post
content or credentials. Aliases let status remain available after local
cleanup and let the service find other local references to the same remote
publication. Root history is bounded by `publishing.deletionHistoryLimit`
(default 20, range 1–100); per-operation alias expansion is bounded by
`publishing.deletionMaxAliases` (default 1000, range 1–10000). Registry version
42 exposes both consumed settings. Non-rejected remote identities remain
tombstoned and prevent duplicate dispatch or status-sync resurrection. The
journal is preserved until workspace erasure; workspace erasure and relevant
connection cleanup refuse unresolved evidence. Completed rows remain as
identity tombstones until erasure.

## Schema and evidence

The schema source `20261016220000_rebuild_post_deletions` is squashed into the
`20261103000000_baseline` migration
(`../prisma/migrations/20261103000000_baseline/migration.sql`), which the
cutover rehearsal checksum-pins. It has a workspace cascade relation,
no post, target, or user foreign keys, state/reason/timestamp constraints, and
a partial unique key for active or completed remote identities. Rejected
history permits a later explicit request.

Before applying the migration to the isolated synthetic preview, a private
custom-format backup was restored and aggregate checks matched across 96 source
tables. The backup is retained privately at
`/private/tmp/socialpilot-preview-before-post-deletion-20261016T210904Z.dump`
(244200 bytes). Restore checks covered the exact source tables and matched the
new migration restore at 97 tables. The migration was applied only to the
isolated preview; production was not changed.

The state/timestamp CHECK uses `IS TRUE`, so PostgreSQL's three-valued CHECK
logic cannot treat a NULL expression as valid. `started` and `completed` allow
their documented NULL reasons; `uncertain`, `remote_confirmed`, and `rejected`
require their specific non-NULL reasons. Negative database tests cover these
cases. The revised DDL has not yet been applied to the preview; that requires a
fresh backup and restore first.

The cutover verifier now pins four migration files and inventories the new
mapped columns. A full four-file rehearsal on a sanitized, production-shaped
baseline has not been proven. The final integrated suite passed 1064 tests in 180 files, including 39 actual
PostgreSQL checks in 15 files; typecheck and an isolated build passed. The local
HTTP/MCP probe and browser recovery checks passed with synthetic data. Provider
and production release evidence remain separate and unproven. The legacy app remains production.

## Remaining gaps

The existing publication receipt gap remains: a remote post may be accepted
while its local post receipt fails to persist. This journal covers remote post
deletion, not publication reconciliation. Live provider deletion outcomes,
provider-specific permissions and formats, delayed effects after cancellation,
production-shaped authorization, complete customer/operator parity, full
four-migration rehearsal, media recovery, and proxy/service rollback remain
release blockers. See [CUTOVER.md](CUTOVER.md),
[PUBLISHING_OPERATIONS.md](PUBLISHING_OPERATIONS.md), and
[LEGACY_CAPABILITY_PARITY.md](LEGACY_CAPABILITY_PARITY.md).

The final SQL was also applied from the pre-journal backup and independently
restored with matching exact counts at 97 tables. A separate restore-verified
97-table preview backup preceded its NULL-safe CHECK amendment
(`/private/tmp/socialpilot-preview-before-post-deletion-constraint-20261016T231821Z.dump`,
249411 bytes). Recovery also handles a requested local post already removed
outside the normal flow: persisted confirmations still reconcile aliases and
complete the journal without another provider call. Other alias post content
is retained; confirmed remote references are cleared and delivery status is
cancelled. See PREVIEW_QA.md for local MCP/browser evidence and limits.
