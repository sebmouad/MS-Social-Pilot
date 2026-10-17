# Durable publication receipt recovery

Implemented in the rebuild; complete Publishing, provider parity and production
cutover remain unfinished. PUBLICATION_RECOVERY_PLAN.md records the design and
follow-up work; ARCHITECTURE_CONTRACT.md remains the required product target.

## Ownership and dispatch

Publishing owns `modules/publishing/server/publication.ts` and its content-free
`rebuild_publication_attempts` journal. The lifecycle retains one current
workspace/post/destination operation guard. It commits the destination claim
and unique attempt together before calling an adapter. Only the invocation
that inserted that attempt owns dispatch; existing attempts cannot send again.
A provider-owned optional classifier may identify a definitive rejection.
Unknown errors, cancellation and persistence ambiguity remain held for review.
The opaque attempt ID is correlation metadata, not a provider idempotency key.

A valid provider receipt first commits as `receipt_recorded` independently of
its projection into the compatible post tables. Projection, aggregate post
status and domain audit then commit atomically with `projected`. A projection
failure leaves a receipt that can finish locally, without creating another
remote post. First-comment delivery starts only after projection succeeds;
manual local recovery does not itself send a first comment. The existing
separate first-comment action remains available after a recovered publication.
Every destination has its own durable state, preserving partial outcomes.

| State | Meaning and continuation |
| --- | --- |
| started | Intent committed; an interrupted attempt stays held |
| uncertain | No confirmed remote outcome; external review required |
| receipt_recorded | Remote receipt saved; finish only the local record |
| projected | Receipt, local status and domain audit committed |
| rejected | Adapter classified an explicit rejection; explicit new attempt allowed |
| attested_absent | Human externally checked absence; explicit new attempt allowed |

There is no automatic resend, lookup or provider reconciliation for uncertain
attempts. A timeout does not prove absence. After a human records absence,
a delayed provider request may still complete; check again before retrying.
Provider-returned and human-recorded outcomes compare the current journal state
under row locks, so a late result cannot silently replace a newer resolution.

## Recovery authority and surfaces

Customer status, adoption, outcome recording and local finish use one domain
service through `/api/publishing/recovery` and workspace MCP. Reads recheck
current active membership, feature permission, selected resources and channel
grants; whole-post visibility follows PUBLISHING_READS.md. Writes acquire the
same operation locks and refresh authority. Only owners, admins and editors
may attest, adopt or finish; workspace membership does not confer private Root
rights. Contributors retain their existing publishing authority without manual
external-outcome authority.

An older `processing` destination with no current attempt can be explicitly
adopted into an uncertain attempt. Adoption makes no provider call and does not
assert whether publication occurred. Human attestation requires an explicit
external verification and an exact operation/outcome confirmation. Published
attestation requires a remote ID and accepts an optional credential-free HTTPS
link. Absence supplies neither. The opaque operation resolves its immutable
workspace, post, destination and provider on the server; client identifiers
cannot redirect an attempt to another post or workspace. The UI must show the
resolved context before confirmation. Known remote deletion tombstones and
remote identities already linked to another post block receipt projection.

Private Root Publishing recovery provides bounded content-free history,
legacy adoption, manual attestation and local projection through its own UI,
HTTP and MCP services. Installation authority is rechecked under locks;
workspace keys cannot use these controls. Root and customer operations audit
the exact actor, operation, scope and outcome without post text, credentials,
raw provider errors or raw provider responses.

## Data lifecycle and configuration

Unresolved intent, uncertainty and pending projection block post changes,
connection removal and workspace erasure even if a legacy status row is
missing or damaged. Resolved history remains until workspace erasure. There
are no post, destination or actor foreign keys that could erase attempt
history; the workspace alone owns its cascade. Workspace export and authorized
erasure discover this table through its workspace ownership.

Registry 44 adds consumed `publishing.publicationHistoryLimit` (default 100,
range 1–1000) and `publishing.publicationUrlMaxCharacters` (2048, range
100–2048). Existing Root operation/transaction and identifier bounds apply.
Customer history prioritizes unresolved attempts and reports truncation;
Root history is explicitly bounded. These settings do not complete the
installation-wide configurable-copy/technical-option catalog.

The fifth additive migration is
`20261017010000_rebuild_publication_attempts`, SHA-256
`03973b6fb80dcf2580c5e39f0d2be8fd5715f47c1a953127ce939638bfece267`.
Its checks require explicit true results for state/receipt/attestation shapes;
a partial unique index retains a claim through projected state and releases
it only for rejected or human-attested-absent attempts. Fixed 2048-character
integrity caps remain separate from stricter runtime input limits. See
CUTOVER.md for the pinned five-file inventory and local restore evidence.

## Evidence and open work

Actual local PostgreSQL checks cover committed intent visibility, concurrent
exclusion, durable receipts after a projection-audit fault, local-only recovery,
uncertain/rejected outcomes, explicit retry, late outcome conflicts, exact
confirmation, role/grant/feature denial and database constraints. Adapters in
these fault tests are controlled mocks. Browser, HTTP and MCP evidence is
recorded separately in PREVIEW_QA.md; synthetic attestation is not verification
of an actual platform post.

Still required: automatic provider-supported lookup/idempotency where available,
full supported Facebook publishing formats and credential/grant coverage,
production-volume recovery/history UX, complete legacy/Root/MCP parity, real
provider create/status/recovery checks with cleanup, production-shaped migration
and permission evidence, exact backup/media recovery, proxy/service rollback
and a single-publisher cutover. Legacy remains the production application.
