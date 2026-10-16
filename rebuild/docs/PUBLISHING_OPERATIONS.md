# Publishing operation boundaries

Status: verified local safety batch, **not complete Publishing or production readiness**. Updated 2026-10-16. The architecture contract and legacy capability gate still apply.

## Ownership and authority

`src/modules/publishing/server/access.ts` rebuilds active-user, membership, feature-write, entitlement and channel authority inside the application service. An optional caller channel constraint can only narrow current grants. `guard.ts` holds one shared workspace operation boundary and fail-fast transaction advisory locks: post first, then sorted destinations. The post lock precedes the read of its destination set. Both existing and requested destinations must be in scope, and authority is refreshed after locks.

All Publishing lifecycle operations and the three unconnected-draft services use this guard. UI actions, the scheduled worker and the named MCP transport bypass list delegate lock ownership to those services; they must not acquire a second workspace operation lock. MCP still performs bearer scope, feature-write, schema and exact-confirmation checks. Local draft creation/edit/deletion now commits its domain audit with the write.

Connection deselection/disconnection uses the same destination locks, then the existing Inbox channel locks. It refuses any stored `processing` publishing result, including after a process restart. Workspace erasure refuses the same unresolved evidence. Local post removal also locks its channels against Inbox operations and refuses unresolved Inbox deletion journals. This is intentionally conservative at channel scope: an unresolved deletion on another post in the same channel can block removal. None of these checks confirms remote absence or permits operators to discard uncertain evidence.

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

The isolated preview suite passed **994 tests in 171 files**, including **16 PostgreSQL tests in 12 integration files**. Typecheck and an isolated production build passed. Three new real-database Publishing tests use independent clients: a held provider response excludes cancel/edit/local delete/source deletion; stale cancelled work performs no provider dispatch; unresolved Inbox deletion prevents local history removal. Their provider and authorization dependencies are mocked; they prove actual database locking, not Facebook or full authorization.

The guarded localhost MCP/HTTP probe exercises scoped creation with first comment, read-only refusal, current grant revocation, current feature revocation, update/audit, unresolved-processing deletion refusal, confirmed local deletion, Root isolation and no-store behavior. It removes its temporary actor, keys, sessions, content and domain audits and restores the original effective MCP role policy. Root policy-change audits remain. No provider is called.

Chrome uses disposable synthetic examples. Phone edit/delete refusals retain values/checkbox/error; desktop deletion failure preserves focus and Escape restores the opener. Successful editing and local deletion were exercised through actual server actions after correcting redirect handling. Exact fixture cleanup was verified. See PREVIEW_QA.md for widths/theme limits. Independent lower-cost review found no additional introduced defect after the redirect fix; the recovery findings below remain open.

## Release blockers and next work

1. `processing` without a remote ID has no durable operator/customer reconciliation action. The new cleanup refusal preserves evidence but can leave the post, source or workspace deletion blocked until such recovery exists. Do not clear it by retrying publication or editing database rows in production.
2. Successful remote deletion followed by failed local receipt/audit persistence has no durable deletion journal or provider-confirmed recovery. A later provider not-found response is not automatically proof of this operation's success.
3. The subsequent first-comment batch now commits post receipts before separate comment dispatch, retains uncertain comment claims, and provides explicit sending/manual outcome recording through UI/MCP. See FIRST_COMMENT_DELIVERY.md. A failed post-receipt transaction still needs the publication reconciliation workflow in item 1; delayed comments and automatic provider verification remain open.
4. Facebook formats/grants, multi-photo orphan cleanup, native scheduling, full legacy workflows, all-state UX and real provider create/status/delete checks remain required. The Posts list also still exposes a synthetic retained post on an unselected channel; selected-resource read/retained-history policy needs correction and tests.

No schema, migration, production traffic, worker ownership or deployment was changed by this batch. Keep legacy production running until the complete release gates pass.
