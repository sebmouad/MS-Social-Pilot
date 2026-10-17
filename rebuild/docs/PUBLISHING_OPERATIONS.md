# Publishing operation boundaries

Status: local Publishing safety and durable remote-deletion recovery are implemented, **not complete Publishing or production readiness**. Updated 2026-10-16. The architecture contract and legacy capability gate still apply.

## Ownership and authority

`src/modules/publishing/server/access.ts` rebuilds active-user, membership, feature-write, entitlement and channel authority inside the application service. An optional caller channel constraint can only narrow current grants. `guard.ts` holds one shared workspace operation boundary and fail-fast transaction advisory locks: post first, then sorted destinations. The post lock precedes the read of its destination set. Both existing and requested destinations must be in scope, and authority is refreshed after locks.

All Publishing lifecycle operations and the three unconnected-draft services use this guard. UI actions, the scheduled worker and the named MCP transport bypass list delegate lock ownership to those services; they must not acquire a second workspace operation lock. MCP still performs bearer scope, feature-write, schema and exact-confirmation checks. Local draft creation/edit/deletion now commits its domain audit with the write.

Connection deselection/disconnection uses the same destination locks, then the existing Inbox channel locks. It refuses any stored `processing` publishing result, including after a process restart. Workspace erasure refuses unresolved publishing, Inbox, or remote-post-deletion evidence before local data removal. Local post removal also locks its channels against Inbox operations and refuses unresolved Inbox deletion journals. This is intentionally conservative at channel scope: an unresolved deletion on another post in the same channel can block removal. None of these checks confirms remote absence or permits operators to discard uncertain evidence.

## Scheduling and cancellation

The worker passes the original scheduled timestamp to `publishPost`. Under the post lock the service requires the same scheduled state and timestamp; a cancelled, rescheduled, removed or concurrently claimed candidate is skipped. Explicit manual publication remains a separate call without this expected timestamp.

Registry **40** adds these consumed Publishing-owned Root controls:

| Setting | Default | Purpose |
| --- | --- | --- |
| `publishing.operationTimeoutMs` | 60000 | Cancellation budget starting at guard transaction entry, including authorization and scope reads |
| `publishing.operationMaxWaitMs` | 2000 | Guard transaction connection acquisition |
| `publishing.transactionTimeoutMs` | 15000 | Atomic local mutation/audit duration |
| `publishing.transactionMaxWaitMs` | 5000 | Local transaction connection acquisition |
| `publishing.maxTargetsPerOperation` | 5000 | Distinct destination locks across a complete operation, including old/new destinations and CSV rows |
| `publishing.identifierMaxCharacters` | 200 | Post/destination identifier bound |

The guard timeout is the operation budget plus twice the local duration/acquisition budgets plus guard acquisition. It must fit strictly inside the Shared workspace-operation timeout; incompatible configurations fail before provider dispatch. The provider-neutral signal is checked between phases and before local transactions. Facebook combines it with each configured request timeout, including multi-image and first-comment follow-ups. A timeout is not proof that a provider did not accept content. Prisma timeouts and cooperative abort checks do not establish hard database/remote side-effect cancellation under every driver or network failure. Pool exhaustion and production-scale concurrency remain unverified.

The Facebook adapter also owns remote-status credential readiness using its Root-configured post-read scope policy. Shared Publishing no longer knows Facebook scope names. Complete publishing/first-comment/delete grant enforcement remains a separate gap.

## Customer recovery behavior

Inline editing retains text, first comment, destinations, attachment values and uploaded references on a service or transport failure. Delete confirmation stays open with its remote-deletion choice and focused error. Pending edit/delete disables competing row controls. Cancel/Escape returns focus to the opener. Successful actions revalidate Publishing views and redirect only after service completion. Client transport wrappers must rethrow Next redirect control flow; a real browser success test found and fixed a false error after successful saving. A status refresh with zero confirmed results no longer claims successful synchronization.

Other row mutations, action availability for inconsistent stored states, complete attachment editing and complete filter preservation after mutations are still unfinished.

## Evidence

The earlier isolated preview suite passed **994 tests in 171 files**, including **16 PostgreSQL tests in 12 integration files**, before the durable post-deletion batch. Typecheck and an isolated production build passed for that earlier snapshot. Three real-database Publishing tests at that stage used independent clients: a held provider response excludes cancel/edit/local delete/source deletion; stale cancelled work performs no provider dispatch; unresolved Inbox deletion prevents local history removal. Their provider and authorization dependencies are mocked; they prove actual database locking, not Facebook or full authorization. Do not use this prior count as final evidence for the post-deletion batch; current verification remains a separate pending result.

The guarded localhost MCP/HTTP probe exercises scoped creation with first comment, read-only refusal, current grant revocation, current feature revocation, update/audit, unresolved-processing deletion refusal, confirmed local deletion, Root isolation and no-store behavior. It removes its temporary actor, keys, sessions, content and domain audits and restores the original effective MCP role policy. Root policy-change audits remain. No provider is called.

Chrome uses disposable synthetic examples. Phone edit/delete refusals retain values/checkbox/error; desktop deletion failure preserves focus and Escape restores the opener. Successful editing and local deletion were exercised through actual server actions after correcting redirect handling. Exact fixture cleanup was verified. See PREVIEW_QA.md for widths/theme limits. Independent lower-cost review found no additional introduced defect after the redirect fix; the recovery findings below remain open.

## Release blockers and next work

1. `processing` without a remote ID has no durable operator/customer reconciliation action. The new cleanup refusal preserves evidence but can leave the post, source or workspace deletion blocked until such recovery exists. Do not clear it by retrying publication or editing database rows in production.
2. Remote post deletion now has durable intent, receipt, aliases, status and explicit operator recovery; provider exceptions stay uncertain, with no automatic provider verification or retry. Live provider deletion and attestation workflows still need production-shaped verification.
3. The subsequent first-comment batch now commits post receipts before separate comment dispatch, retains uncertain comment claims, and provides explicit sending/manual outcome recording through UI/MCP. See FIRST_COMMENT_DELIVERY.md. A failed post-receipt transaction still needs the publication reconciliation workflow in item 1; delayed comments and automatic provider verification remain open.
4. Facebook formats/grants, multi-photo orphan cleanup, native scheduling, full legacy workflows, all-state UX and real provider create/status/delete checks remain required. The subsequent selected-resource read batch closes the normal-view retained-post leak across UI, HTTP, MCP and Home counts; see PUBLISHING_READS.md. Dedicated retained-data browsing and complete read/API pagination parity remain open.

The post-deletion batch added one checksum-pinned additive migration, applied only to the isolated preview after restore verification. It did not change production traffic, worker ownership or deployment. Keep legacy production running until the complete release gates pass.

## Durable remote post deletion — 2026-10-16

`modules/publishing/server/deletion.ts` owns the durable deletion workflow. It writes content-free per-identity intent before contacting the adapter, leaves every provider/transport exception uncertain, persists each confirmed outcome before local finalization, and keeps a partial result when a later destination fails. Uncertain attempts are not automatically resent. No automatic provider verification is implemented. Workspace members use the shared UI/MCP service for status, explicit deletion, externally checked outcome recording, and local finalization; private Root UI/HTTP/MCP exposes bounded history and explicit human attestation. Attestation records an operator's external check; it is not an API verification, and a late provider effect can still occur.

Local post and destination aliases retain status after cleanup and let finalization clear duplicate references to one remote identity. Non-rejected rows, including completed ones, remain tombstones until workspace erasure and prevent duplicate dispatch or status-sync resurrection. The journal contains remote IDs and local aliases, not post content or credentials. Registry 42 manages consumed Root history (20 by default, 1–100) and alias bounds (1000 by default, 1–10000). Workspace erasure and relevant connection cleanup refuse unresolved evidence.

The migration is the fourth checksum-pinned additive migration in the cutover verifier. Before its preview-only application, a 244200-byte private backup was restored and checked against its exact 96 source tables; the migration restore matched the 97-table inventory. The backup remains at `/private/tmp/socialpilot-preview-before-post-deletion-20261016T210904Z.dump`. This does not establish a production-shaped four-file rehearsal. The current integrated test counts and build evidence are pending; consult [POST_DELETION_RECOVERY.md](POST_DELETION_RECOVERY.md) and [CUTOVER.md](CUTOVER.md) for evidence boundaries.


## Publication receipt journal follow-up — 2026-10-17

The publication receipt gap in item 1 now has durable intent, an independently
committed receipt, atomic local projection/audit and explicit recovery surfaces.
See PUBLICATION_RECOVERY.md. Unknown outcomes are never automatically resent;
Root/customer human attestation is separate from provider verification. Local
PostgreSQL fault/concurrency evidence does not establish live Facebook behavior,
full provider formats, complete parity or production cutover. Those gates remain.
