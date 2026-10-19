# Asynchronous publication receipts

Status: the shared publication service distinguishes a provider submission from
a confirmed publication. This is service and recovery behavior; it does not
enable native Facebook formats or establish whole-app/cutover completion.

## Result contract

Every platform `PublishResult` declares `state: 'published' | 'submitted'`.
`published` means the adapter has evidence that the final post is live.
`submitted` means the provider accepted or identified an operation without
proving that it is live. A remote ID alone is not a publication confirmation.
Missing or unknown states, unsafe returned URLs and cancellation after a valid
receipt are held as submitted evidence when the ID can be persisted. They do not
promote the post target or trigger another provider create. If receipt
persistence is blocked or fails, the outcome remains held without projection.
Invalid or missing identifiers remain unresolved without inventing a receipt.

The parent `rebuild_publication_attempts` row remains the only active publication
claim. The additive migration
`20261019050000_rebuild_publication_submissions` extends its allowed state and
reason. Submitted rows require `provider_submission`, a non-null `remotePostId`
and `receiptAt`, null `projectedAt`, `attestedAt` and `attestedBy`; `remoteUrl`
may be retained. The active-claim unique index and purge trigger stay in place.

## Receipt persistence and recovery

After a provider call returns a usable ID, receipt-only persistence may run in a
short, bounded transaction even when the operation signal was cancelled. It is
conditional on the original parent still being `started` and the database write
succeeding. It can only record the receipt; it cannot start another provider
request. If the parent was already resolved/replaced or the write fails, the
service holds the outcome without projection. The first `receiptAt` and provider
URL are preserved if the receipt is later externally attested. `attestedAt` records when human verification was saved. Local projection uses
that verification timestamp instead of the original submission time.

A known submitted ID cannot be attested absent or replaced by a different ID.
The Root recovery action and the customer publication status UI are distinct
surfaces and need separate verification. Provider outcome guards run again at
projection time. For native Facebook work, projection also requires a current
accepted native status proof. Shared result attestation alone cannot promote an
unverified native submission.

General late-fact append and reconciliation across already-resolved shared
parents remain future work; Facebook's private native journal continues to
retain its own native facts. Automatic pending-status reconciliation, safe
provider deletion/comment integration and the canonical native host remain open.

Duplicate/deletion identity conflicts retain the usable ID as submitted evidence
and audit the conflict, without linking it to another post or overriding deletion.
The same collision guard still refuses later attestation/projection. Cancelled
failed requests also persist bounded rejection/uncertainty facts when the original
claim remains open. Invalid configuration or database failure cannot promise a
receipt write; unresolved intent remains held.

Current whole-post visibility conservatively requires current channel scope.
Retained history after deselection/disconnect needs its own authorized UX review;
this batch does not weaken that boundary based on partial-source review findings.

## Facebook boundary and remaining work

The current Facebook feed publishing path returns an explicit published result.
The video-upload path returns submitted when it has only an upload identity;
video remains in the current media descriptor. Private native publishing formats
are still disabled. Automatic native host dispatch, pending-status polling,
safe provider deletion, first-comment integration and live-provider coverage
remain open. No provider result should
advertise those operations as complete until the owning adapter and canonical
shared host path provide their full authorization, recovery and verification.

## Batch92 evidence

Migration21,
`20261019050000_rebuild_publication_submissions`, has SHA-256
`91011f00b776d402038d74ff1862e5ab352bbeb500d386b5000172a17ffb5931`. A fresh
full backup and scratch restore preserved all107 prior public table counts and
Root settings; the migration was applied to the isolated synthetic local preview
only. The complete21-file schema-only rehearsal passed. Actual PostgreSQL
coverage passed the native proof → matching Root attestation → publication
projection chain. This does not establish production-shaped data/media rollback.

Final isolated suite:3,150 tests across356 files, zero skips; production build
and serial typecheck passed. Actual PostgreSQL tests cover missing/unknown states,
cancelled success/failure, unsafe URLs, duplicate remote-ID collisions, exact-ID
attestation, preserved receipt facts, data-erasure guards and native proof → Root
attestation → separate projection. Root browser probes passed16 views (two flows
across four themes at1440px/390px), including read-only IDs, no absence option,
Cancel/Escape/focus, sidebar filters and viewport fit. API/installation MCP passed
current authorization, wrong-identity/absence refusals and exact-ID local recovery;
workspace keys retain no Root access. Exactly two local HTTPS-mock GETs occurred;
attestation/projection added no provider request. Customer component tests passed;
full customer recovery browser coverage remains a separate gate.

Both Claude accounts reviewed source. Cancellation, unsafe URL, required receipt
state, duplicate-ID retention and original-URL preservation findings were addressed
and tested. Conditional scope/host findings were checked against installed guards;
these reviews are not live-provider proof. The response-byte limit is included in
the current native read trust snapshot. All107 original table counts and exact
Root settings matched after final cleanup; the scratch database was removed and
the full backup retained. Production and the held provider canary remain unchanged. See
[CUTOVER.md](CUTOVER.md), [FACEBOOK_NATIVE_JOURNAL_PLAN.md](FACEBOOK_NATIVE_JOURNAL_PLAN.md)
and [PREVIEW_QA.md](PREVIEW_QA.md) for their respective evidence boundaries.
