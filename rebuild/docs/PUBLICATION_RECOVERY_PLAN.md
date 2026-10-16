# Durable publication receipt recovery plan

Status: **planned and unfinished**. This document records the required recovery design and implementation sequence. It does not claim that publication journaling, operator recovery, provider reconciliation, or release readiness is implemented. The required product and module boundaries remain in [ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md); this plan does not narrow Publishing parity or the release gates.

## Current failure

`src/server/publishing/lifecycle.ts` currently claims a `post_targets` row by changing its status to `processing` before calling the selected adapter's `publish`. Once the adapter returns, the service validates the remote identifier and writes `status`, `remotePostId`, `remoteUrl`, `publishedAt`, and the domain audit in a separate database transaction. If the provider accepted the post but the response was lost, malformed, or the receipt transaction failed, the database can retain only `processing` with no remote ID. The product cannot tell whether the remote post exists.

This state is intentionally not retried: the lifecycle skips `processing`; `publishDuePosts` selects due scheduled posts only when a target is `pending`; and local edit, deletion, connection cleanup, and workspace erasure guards preserve or block on unresolved publishing evidence. As a result, an accepted remote post can become permanently undiscoverable to the app while blocking cleanup. The current `PublishRequest` has no operation identity, idempotency declaration, or provider reconciliation result.

First-comment delivery already has the correct ordering constraint: the post receipt and published target state commit before a separate first-comment attempt is claimed and dispatched. Receipt-loss recovery must preserve this ordering. A comment must never be sent until the post receipt is durably available to the application.

## Target ownership and record

Publishing owns a provider-neutral operation journal in `src/modules/publishing/server/`. The shared lifecycle coordinates authorization, locks, persistence, audit, and projection. A selected platform adapter owns provider request mapping, protocol error classification, provider idempotency guarantees, and provider-specific reconciliation. Root owns private installation-wide inspection and attestation controls. UI, HTTP, MCP, and worker entry points call the same Publishing services.

Use one durable operation per destination attempt. The additive journal should include:

- Opaque operation ID; workspace, post, post-target, and target aliases; provider module ID; initiating actor; state and safe reason; creation/update/dispatch/receipt/projection timestamps.
- A validated remote ID and safe URL only after a receipt or an authorized external attestation supplies them.
- No post text, first-comment text, media bytes/URLs, access tokens, raw provider payloads, or raw provider error strings.

Do not store a plain content hash as an operation identity: low-entropy post text can be guessed. The operation ID identifies the attempt; local row aliases tie it back to product records. Bound alias expansion and operator history, following the remote-deletion journal's pattern. Retain resolved operation rows and remote-identity tombstones until workspace erasure. Workspace erasure must refuse unresolved attempts; resolved journal rows may be erased with their workspace under the documented data-erasure policy.

The migration is strictly additive. Rebuild Prisma is a partial compatibility view of existing production tables; do not alter or recreate legacy tables and do not use `prisma db push`. Add the SQL under `app/prisma/migrations/`, then pin its checksum and mapped-table/column expectations in `rebuild/scripts/cutover-rehearsal.sh` and its verifier tests. Use workspace ownership only for the journal's foreign-key lifecycle; avoid foreign keys to posts, post targets, or actors so local cleanup cannot cascade away unresolved evidence. Any state/timestamp `CHECK` expression must end in `IS TRUE` so PostgreSQL NULL semantics cannot make an incomplete invariant pass. Add database constraints for valid states and timestamps, bounded identities/reasons, workspace-scoped operation IDs, and uniqueness that prevents concurrent unresolved attempts for one destination while preserving immutable attempt history.

## State transitions and dispatch ordering

The journal must separate a provider receipt from its projection into current product rows:

| State | Meaning | Allowed continuation |
| --- | --- | --- |
| `started` | Intent and target claim committed before provider dispatch | Continue that exact dispatch; after restart, treat it as unresolved until provider or human reconciliation |
| `uncertain` | Timeout, transport loss, malformed success, cancellation, or unknown outcome | Provider reconciliation where implemented, or exact-scoped human attestation; never resend automatically |
| `receipt_recorded` | A validated remote receipt is durable in the journal | Retry only local projection and audit; never call provider create again |
| `projected` | Receipt and audit are reflected in `post_targets` and the post lifecycle | Continue to first-comment attempt if requested; preserve operation as a tombstone |
| `rejected` | The adapter classified a definitive provider rejection | Record failure; a later explicit publish may create a new operation ID |
| `attested_absent` | An authorized human externally checked and recorded that the remote post is absent | A later explicit publish may create a new operation ID; disclose delayed in-flight effects |

Commit the `started` journal row and claim for its `postTarget` atomically before dispatch. The adapter's validated response must be committed as `receipt_recorded` before updating the legacy-compatible post target. Then, in a local transaction, project the receipt into `post_targets`, update the post's aggregate state as appropriate, write the domain audit, and advance the journal to `projected`. If projection or its audit fails, the durable `receipt_recorded` row supports a local-only continuation. Only after projection commits may the lifecycle claim or send a requested first comment.

For multi-destination posts, each destination has independent durable state. Persist every success before moving to another destination. Return partial success honestly and derive aggregate post state from the per-destination receipts plus remaining failed or unresolved targets. A later destination failure must not erase earlier receipts or invite duplicate sends for completed destinations.

On a thrown publish error, only the adapter may classify a definitive rejection. `classifyPublishingFailure` must remain inside the provider module and use only provider-documented, explicit rejection signals; unknown codes, rate limits, server errors, cancellation, malformed responses, and transport/database ambiguity remain unresolved. Persist the safe classification and audit. If recording a rejection itself fails, leave the committed `started` intent held; never clear the claim because the database write failed.

## Idempotency and provider reconciliation

The neutral contract may carry an opaque operation ID to an adapter. That ID is not itself an idempotency guarantee. Each provider module must declare whether it can map the ID to a provider-supported idempotency key and document the provider's exact semantics before shared orchestration relies on it. Provider-specific key formats, lookup endpoints, response parsing, and expiry windows stay inside that provider module.

Provider reconciliation should return a neutral result such as `found(receipt)`, `absent`, or `unknown`. `found` supplies a validated receipt for local journal persistence; `absent` permits a controlled new attempt only after the service records the old attempt as resolved; `unknown` remains held. A future worker may lease and reconcile eligible operations through that capability with bounded scheduling and run history. It must not rerun the original create call merely because a lease expired or a timestamp is old. The first recovery batch should not add automatic retries for uncertain operations or advertise reconciliation for a provider that lacks a real implementation.

## Customer, MCP, and Root authority

All customer recovery entry points share the Publishing domain service and its existing post/destination operation locks, current workspace authorization, feature entitlement, and resource scope. A customer manager (owner, admin, or editor, matching the existing remote-post deletion recovery boundary) can inspect and manually reconcile an operation belonging to a post and destination currently in that manager's workspace scope. Contributors retain the existing own-post boundaries and do not receive manager attestation authority. The service must recheck authority under the operation guard, not trust UI visibility or a previously loaded viewer.

The attestation operation must identify the exact opaque operation ID, workspace, target, and outcome. Require an exact confirmation phrase bound to that operation and outcome. A `PUBLISHED` outcome also requires a validated remote ID and safe URL if available; an `ABSENT` outcome clears no evidence and makes no provider call. Record the actor, time, exact outcome, and `external_human_attestation` provenance in the journal and domain audit. Explain that this is a human's external platform check, not automated verification, and that a delayed request may still complete. A late provider response must not overwrite a newer manual resolution silently; compare-and-set against the journal state and retain conflict evidence.

Workspace MCP tools and resources use the same service and current key feature/resource restrictions as the UI. They return normalized state and safe receipts only, require the same exact confirmations for writes, and cannot acquire Root authority from a workspace key. Private Root UI/HTTP/MCP rechecks current installation-owner status and can inspect bounded content-free history across workspaces. Root attestation uses the same domain transition helper but a separate Root authorization path, workspace operation lock, target lock, and audit. Root must not expose content, tokens, or raw provider errors.

## Implementation batches

1. **Schema and invariants.** Define the table, state/check constraints, uniqueness and retained-identity indexes, data-erasure behavior, checksum pins, and restore-rehearsal expectations. Generate and review the additive SQL; back up and restore-verify the isolated synthetic preview before applying it. Do not change legacy production traffic or shared worker ownership.
2. **Publishing journal service.** Add a product-owned journal service with atomic intent/claim, validated receipt persistence, local projection recovery, adapter-owned rejection classification, partial-result aggregation, and workspace-erasure guards. Add focused state-machine tests and real PostgreSQL concurrency/fault-injection cases proving duplicate dispatch is excluded and receipt projection can resume without provider creation.
3. **Explicit recovery surfaces.** Add customer manager status and attestation UI/API, matching scoped MCP tools/resources, and private Root history/attestation. Reuse the shared service and exact authority boundaries above. Add authorization, exact-confirmation, privacy, audit, stale-state, and delayed-effect tests.
4. **Provider capabilities and worker follow-up.** Only after the generic service ships, implement and verify any provider-declared idempotency or lookup capability. Add bounded reconciliation leases/run history only for adapters with proven behavior. Keep unsupported reconciliation absent from customer choices and Root's available actions.
5. **Operational evidence.** Update [ARCHITECTURE.md](ARCHITECTURE.md), [PUBLISHING_OPERATIONS.md](PUBLISHING_OPERATIONS.md), this plan, migration/recovery docs, and cutover evidence with actual test, browser, database, provider, and production evidence at their true scope. Complete the full legacy parity and release contract before cutover.

## Verification and release limits

The selected-resource read batch has a verified local baseline of 1101 tests across 184 files, typecheck, and production build passing. Those results establish the read-surface batch only; they do not establish this publication recovery design. Each implementation batch must report fresh focused tests, real PostgreSQL failure/concurrency evidence, typecheck, and production build. Browser/API/MCP checks must prove the same current authorization, exact operation binding, safe errors, retained state on failure, and no duplicate provider create. Provider claims require provider-specific tests and live operation evidence. Synthetic preview data, unit tests, and mocked adapters do not prove live provider acceptance or production migration safety.

Before production cutover, complete a sanitized production-shaped restore and checksum-pinned migration rehearsal, confirm a single worker owner, prove backup/restore and rollback, verify live create/status/reconciliation behavior for each enabled provider capability, and pass every architecture-contract release gate. Keep the legacy production application available until those gates pass. No production migration, worker change, deployment, or claim of publication recovery is authorized by this plan alone.
