# Native Facebook journal: foundation and remaining gates

Status: batch89 implements private durable receipts and installed safety guards.
Batch90 hardens status observation boundaries; see FACEBOOK_NATIVE_STATUS.md.
Native customer formats remain unavailable. This is not the complete Facebook
engine, live-provider proof or a production cutover.

## Implemented boundary

`rebuild_publication_attempts` remains the only claim that permits publication.
Its active-destination uniqueness is unchanged. The Facebook-owned raw SQL table
`rebuild_facebook_native_journal` records protocol phase intents and receipts,
not a second publication claim or a replay lease. Immutable scope covers workspace,
parent, post/post-target/target, actor, remote Page, source/native format and the
batch88 payload hash. Receipt aliases survive removal of local projections.
Composite parent and direct workspace FKs support tenant integrity and erasure.

`formats/journal.ts` locks parent before child in each short transaction, without
reacquiring the outer publishing operation's advisory locks. Only the creator
instance owns its unexported token; dispatch writes require its expected revision.
Existing rows and restarted instances cannot acquire ownership or resend. A stale
creator may append newly observed receipt facts, mark a conflict and return false;
it cannot append another dispatch intent. SQL enforces phase chains, append-only
IDs, irreversible confirmations/conflicts, immutable final identity, a transition
matrix, initial live binding and the shared workspace purge write gate.

The bound store checks selected Page/connection, token expiry and saved format at
checkpoint boundaries. It is a trusted private integration seam, not an API or a
replacement for shared authorization. Initial and per-operation permissions,
entitlements and module grants must still be enforced by the eventual host.
Protocol intent means a request may have been sent, not proof of wire delivery.
Final state never substitutes a staged object for an absent Story receipt. Reel
finish acknowledges the addressed video object only after explicit success.

The old unscoped `formats/store.ts` proposal and fake-SQL tests are removed.
Memory storage remains a test/single-process helper; the durable wrapper constructs
its own scoped store. It rejects `:comment`/`:delete` aliases and cannot confirm or
delete objects through the worker port. The existing first-comment/deletion
recovery services remain the required integration path.

## Installed safety and Root UX

Native unsettled intents, known orphans and conflicts block local deletion,
disconnect-with-erasure and workspace purge through the installed neutral hooks,
even when the platform is disabled. Parent outcome attestation cannot promote an
unverified native submission to live or attest unresolved objects absent.

Root/API/installation MCP expose bounded content-free evidence. Fence tokens,
credentials and payload content are absent. Complete identifiers remain stored
and included in scoped redacted exports; oversized multi-ID display cells are
explicitly summarized under the shared evidence wire bound. Stable hashed row IDs
cannot overflow that bound. Submitted receipts are labelled submitted.

The generic Root table accepts validated module-owned summary columns. Facebook
shows state, record type, final identity and update time first. Keyboard-operable
native details retain the complete declared evidence fields; existing confirmed
module actions remain separate. Filters remain in the contextual sidebar/drawer.
Unknown native recovery actions are refused rather than routed to cleanup.

## Migration and evidence

Migration `20261019030000_rebuild_facebook_native_journal`, SHA256
`3ef505dccb5156ea1d84472998d19fb8427b1232669f57ca98a8ac6cd1e04d46`, is locally applied
after a full preview backup, actual scratch restore, matching table counts, final
scratch migration/constraint tests and exact SQL/backup identity checks. All105
prior public table counts and Root settings stayed unchanged; the new table is
empty outside disposable test fixtures. The complete19-file schema-only cutover
rehearsal passed, including its independent backup/restore check. This is not
production-shaped customer-data/media/service rollback proof. See CUTOVER.md.

Actual PostgreSQL cases cover concurrent creators, stale revisions/tokens,
immutable bindings, late parent/connection/revision receipts, all four phase
chains, outer advisory locks, strict JSON, terminal late-ID conflicts, purge gates,
real redacted export and children-first erasure with foreign-workspace survival.
Final isolated suite:3059 tests/350 files, zero skips, production build and
serial typecheck. Actual local API/MCP/browser checks passed eight four-theme
desktop/phone views, keyboard details, privacy/scope/refusal checks and exact
cleanup. The current handoff records the scoped evidence. Both Claude accounts and lower-cost native agents contributed
implementation/reviews. Review findings were checked against actual host rules;
partial-source reviews are not provider or PostgreSQL proof.

## Required next integration

1. Complete native host dispatch with current shared authorization, module/plan/
   scope checks, actual media probing and immutable source handling. Keep only
   the existing implemented feed format customer-visible until these pass.
2. Implement verified final status and canonical shared first-comment/deletion
   recovery. Root needs audited resolution for held native receipts and late
   facts after process loss; irreversibly conflicted rows currently remain held.
3. Verify eventual host/webhook recovery cannot acquire dispatch authority or
   bypass unresolved-orphan guards. Test races at that actual service boundary.
4. Complete UI/API/MCP authorization, local failure/retry UX and cleaned live
   Meta receipts for supported formats before enabling them.
5. Complete the broader legacy parity, configuration, production-shaped data/
   media migration and application/service rollback gates before deployment.

Production and the held photo-cleanup canary remain unchanged.


Batch90 removes unsafe status-to-confirmed/rejected promotion from the private
scaffold. Polling cancellation, immutable inputs, final-identity requirements and
explicit update receipt handling are tested. This closes scaffold hazards, not
required integration item2: the authorized identity-bound durable proof writer,
Root resolution and process-loss recovery still need implementation.
