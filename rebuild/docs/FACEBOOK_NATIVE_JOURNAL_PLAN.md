# Native Facebook journal: foundation and remaining gates

Status: batch89 implements private durable receipts and installed safety guards;
batch90 hardens observation boundaries; batch91 adds the identity-bound proof
writer and private Root recovery action. See FACEBOOK_NATIVE_STATUS.md. Native
customer formats remain unavailable. This is not the complete Facebook engine,
live-provider proof or a production cutover.

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
recovery services remain the required integration path. Batch91 adds a separate
identity-bound Video/Reel GET proof writer and audited Root resolution service;
it accepts only the displayed revision after rechecking current Page, grants,
credentials and configuration. Revoked authority before GET yields audited
unknown without provider I/O. Accepted proof is required by installed parent
outcome/erasure guards, while the parent shared publication outcome stays
separate from child proof.

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
Unknown native recovery actions are refused rather than routed to cleanup. Batch91
Root/API/installation-MCP recovery records no content in proof rows and remains
available for bounded evidence inspection while Facebook or its default-off
`facebook.native.statusRecoveryEnabled` flag is disabled. This does not grant
workspace clients Root authority.

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
2. Integrate canonical shared first-comment/deletion recovery. Root still needs
   process-loss/late-fact resolution for held receipts; irreversibly conflicted
   rows remain held. The identity-bound status-proof writer and Root acceptance
   path are implemented in batch91, but do not resolve every such conflict.
3. Verify eventual host/webhook recovery cannot acquire dispatch authority or
   bypass unresolved-orphan guards. Test races at that actual service boundary.
4. Complete UI/API/MCP authorization, local failure/retry UX and cleaned live
   Meta receipts for supported formats before enabling them.
5. Complete the broader legacy parity, configuration, production-shaped data/
   media migration and application/service rollback gates before deployment.

Production and the held photo-cleanup canary remain unchanged.


## Batch91 status-proof recovery and remaining work

The identity-bound proof writer, private Root confirmation/recovery service and
proof-backed installed outcome/erasure guards are implemented. The Root
confirmation binds to the displayed revision; acceptance takes short parent-first
fencing and acceptance transactions, audits atomically, and rechecks current
authority after the GET. It does not acquire creator dispatch ownership or resend.
Changed-revision, stale-credential and non-positive observations remain retained
as observations rather than dispatch authority. Parent outcome remains distinct.

Migration20 (`20261019040000_rebuild_facebook_native_status_proofs`, SHA256
`253e8fb4f18b4cf60fcce16702772dd166358e641fb875c2781cb84d8dc767d4`) passed full
backup/scratch-restore verification before local application. The complete20-file
schema-only rehearsal passed; 106 prior table counts/settings were preserved and
the proof ledger is table107. The suite passed3136 tests/355 files, zero skips,
including26 actual PostgreSQL journal/recovery cases (14+12); build/typecheck
passed. Both Claude accounts reviewed the source and findings were checked.
Built-server HTTPS-mock Root API/MCP and eight desktop/phone views across four
themes passed, with exactly two GETs (accepted published browser proof; held
scheduled MCP observation). Screenshot review caught and fixed a390px Cancel-action wrap; the responsive
footer passed the final build/typecheck, eight-view probe and phone inspection. No live Meta or
production request/change occurred. This rehearsal is not production-shaped
service/media/customer rollback.

Remaining: canonical host dispatch and its shared authorization/media checks;
canonical shared first-comment and deletion services; recovery for process-loss,
late receipts, unresolved orphans and irreversibly conflicting rows without
resend; host/webhook races that preserve dispatch fencing; cleaned live Meta
coverage for any supported format; and broader parity plus production-shaped
data/media/service rollback. Keep customer native formats unavailable. Production
and the held photo-cleanup canary remain unchanged.


## Batch92 shared publication submission boundary

The parent attempt journal now admits `submitted`/`provider_submission`. This
represents an accepted provider submission with an ID, not proof of live
publication. The shared adapter result requires an explicit `published` or
`submitted` state; missing/unknown state, unsafe returned URL and cancellation
after a usable receipt stay submitted and are never projected. Receipt-only
persistence after cancellation is permitted only while the original shared
parent is still `started` and the bounded DB write succeeds. If resolved,
replaced or unwritable, the result remains held. This write does not dispatch.

Known submitted IDs cannot be recorded absent or replaced. First `receiptAt`
and provider URL are preserved on matching Root attestation; `attestedAt` is
set when verification is recorded and used by local projection. The projection path rechecks provider outcome guards
and requires a current accepted native status proof when native work is involved.
General late-fact append/reconciliation for already-resolved shared parents is
not implemented; Facebook's private native journal retains its own phase facts.

Migration21 `20261019050000_rebuild_publication_submissions` has SHA-256
`91011f00b776d402038d74ff1862e5ab352bbeb500d386b5000172a17ffb5931`. Full
backup/scratch restore preserved107 prior table counts and Root settings; the
additive migration was applied to the synthetic local preview only. The full
21-file schema-only rehearsal passed. Actual PostgreSQL native proof → matching
Root attestation → publication projection passed. Final suite:3,150 tests/356
files, zero skips; build/typecheck passed. Root browser/API/MCP checks passed16
views across four themes/two widths with two local HTTPS-mock GETs and exact-ID
attestation/separate projection. Both Claude accounts reviewed source; concrete
receipt-retention findings were fixed and tested. All107 original counts/settings
matched after cleanup; scratch removed, full backup retained. Customer components
passed tests; full customer recovery browser coverage remains separate.

Facebook feed currently returns explicit `published`; video upload identity is
`submitted`, with video still in the current media descriptor. Native formats
remain disabled. Automatic native host dispatch, pending-status reconciliation,
safe provider deletion, comment integration and live-provider proof remain open.
Production and the held provider canary remain unchanged. See
[ASYNC_PUBLICATION_RECEIPTS.md](ASYNC_PUBLICATION_RECEIPTS.md) for the shared
receipt contract.


## Batch96 host dispatch and remaining work

`formats/publish.ts` is now the first caller of `executeFacebookNativeWithJournal`
for customer-path publishing: the shared claim's `publication` identities
(workspace, post, destination, actor) plus its operation id become the journal
binding; remote Page id and source format id come from the request. The creator
instance owns dispatch fencing as designed; a journal or conflict failure throws
an ambiguous error so the shared claim stays held. The path is behind
`facebook.native.publishingEnabled` (default off) and is covered by mocked tests
only, with no PostgreSQL run of the host-to-journal chain yet.

Still required: an actual PostgreSQL test of host → shared claim → journal →
submitted receipt; native first-comment and delete routing for Reels; process-loss
and late-fact recovery; shared stored-video resolution; live Meta coverage.
