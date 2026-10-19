# Native Facebook journal: next integration gate

Status: required work; not a shipped durable engine. Native formats remain
unavailable. Batch88 implements payload snapshots and truthful executor results.
The local child-journal SQL proposal is unapplied and excluded from that batch.
Do not run it or extend the cutover allowlist until the gates below pass.

## Ownership and dispatch authority

`rebuild_publication_attempts` remains the only claim that permits a publication.
Its existing active-destination uniqueness must remain authoritative. A
Facebook-owned child records protocol phase intents and receipts, not a second
publication claim or a replay lease. Bind it immutably to workspace, parent,
post/post-target/target, actor, remote Page, source format, native format and the
versioned payload hash. No projection foreign keys: receipts must survive removal
of local projections. A direct workspace FK supports export and erasure.

The bound store must lock parent before child in each short transaction, without
reacquiring the outer publishing operation's advisory locks. A child UPDATE
trigger cannot establish that ordering: its row is already locked. Verify actual
concurrency and deadlock behavior. Only the first worker owns an unexported fence
token; every write checks token and revision. Restarts cannot take over or resend
an uncertain phase automatically.

## Receipt integrity and recovery

Initial intent requires the live matching selected connection and processing
destination, with no saved remote publication. Subsequent dispatch checkpoints
must recheck current operation authority. Late provider facts must still be
recordable after the parent becomes terminal or projections disappear; reject
further dispatch and hold contradictory outcomes for review. Do not discard late
IDs merely because the parent changed.

Enforce bounded unique append-only IDs, exact per-format phase prefixes,
irreversible confirmations, immutable bindings and an explicit state-transition
matrix. Preserve final identity once established. Distinguish submitted from
confirmed live status; an upload ID cannot substitute for a missing Story ID.
Reel finish acknowledges the addressed video object only after explicit success.
Protocol intent means a request may have been sent, not proof of wire delivery.

All unresolved phase intents, known orphans and conflicting late receipts must
block local deletion, disconnect-with-erasure and workspace purge through the
existing neutral recovery hooks. Parent outcome attestation must not bypass this
evidence. Expose bounded content-free Root evidence without the fence token.
First comments, remote deletion and final readback use the existing authorized
recovery services; do not enable independent `:comment`/`:delete` child claims.

## Evidence required before applying or enabling

- Fresh backup, actual scratch restore and table-count verification.
- Actual PostgreSQL migration syntax and constraint tests, including rejected
  invalid JSON, rewritten aliases, identity changes and regressing confirmations.
- Concurrent begin: exactly one owner; stale tokens/revisions and foreign scope
  refused; parent-state changes preserve late facts but stop the next dispatch.
- Real export redacts fence tokens; unresolved erasure is refused; settled fixture
  erasure follows FK order and preserves foreign workspace records.
- Updated checksum-pinned cutover manifest and complete schema rehearsal.
- Integrated publication/status/comment/deletion tests, UI/API/MCP authorization,
  cleaned live-provider evidence, and the broader release/rollback gates before
  advertising formats or cutting over production.

Claude reviewed both the executor changes and the unapplied SQL proposal. Its
findings are leads, not PostgreSQL evidence. In particular, late receipt retention,
parent uniqueness and file-URL upload support must be assessed against the actual
host and transport, rather than removed based on a partial source review.
