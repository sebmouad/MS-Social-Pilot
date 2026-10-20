# Facebook native status and recovery boundary

Status: batch91 implements private, default-off native status proof recovery.
Native customer formats remain unavailable. Submission receipts, status
observations, accepted recovery proof and remote cleanup are separate facts.

## Implemented safety

Status reads require an explicit final remote identity. A known upload/photo ID
is never substituted for a missing final publication ID. Video and Reel use the
existing conservative Video mapping; both Story formats remain unsupported until
the correct final object and endpoint have been verified. Unknown/malformed
responses and Graph100/sub33 never prove absence.

Polling snapshots caller inputs, validates bounds against the Root registry,
passes fresh field arrays and supports caller cancellation through the signed
transport and polling waits. An individual read signal is combined with transport
lifetime cancellation and its configured timeout. Cancelling one read does not
poison later calls. A one-read cleanup inspection does not wait between polls.

The old reconciliation scaffold no longer promotes status observations to a
confirmed publication, treats scheduled as live, or rejects a known remote object
because its processing failed. It keeps incomplete attempts held. An update needs
an explicit true receipt; refused, malformed or failed writes cannot manufacture
a successful settlement. Concurrent durable outcomes are reread when possible. Cancellation reports an
explicit flag and an unknown state when no durable row was read; it does not
invent an uncertain stored state. Remote deletion receipts do not overwrite a
parent concurrently moved out of its eligible state.
No new dispatch claim, retry lease or remote write is granted by status reads.

The old first-comment/delete helpers require explicit final identities and remain
unregistered. Their source and mocked tests are not canonical shared service
integration, durable recovery or live Meta evidence. Their child-suffix model must
not be connected to the scoped native journal.

## Recovery implementation boundary

The next implementation must provide a Facebook-owned, identity-bound status
proof and an audited recovery writer under existing shared Root/service authority.
The proof needs the exact workspace, parent, post-target, Page, native/source
format, payload hash, final object kind and identity, observed revision, response
identity and observation time. Provider ownership/grants and current selection
must be checked at the actual service boundary. An encoding-ready upload is not
proof of a live Reel or Story. Schedule evidence must remain distinct from live
publication. Missing/inaccessible objects remain unknown until positive evidence
supports the claimed outcome.

Recovery must use the existing parent claim and short parent-first transactions,
not acquire creator dispatch ownership or resend. Preserve remote facts when
local projection, credentials or connection state changes during a read. Account
for known orphan IDs and late receipts; a final-post observation cannot clear
unrelated staged-object cleanup. Root/API/installation MCP need the same scoped,
audited resolution service and useful held/conflict results. Workspace MCP must
not acquire private Root authority.

Integrate native publishing, status, first comments and deletion through canonical
shared application services only after real authorization/race tests. Verify
actual provider responses with identifiable test content, inspect results and
clean up before advertising any new customer format. Production and the held
photo-cleanup canary are unchanged.

## Batch90 evidence

Isolated local PostgreSQL suite3082 tests/351 files, zero skips; production build
and serial typecheck passed. Twenty new status boundary cases and three added
transport cases include actual loopback stalled-body cancellation/reuse. Both
Claude accounts reviewed; the correction review is source-only. There is no new
UI/browser, migration application, live Meta or production evidence.

## Protocol research boundary

Reviewed Meta's official [Python AdVideo SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/advideo.py)
and [VideoStatus type](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/videostatus.py).
They provide field/type declarations for further identity/status work. SDK
declarations alone do not prove the configured API version, Page/Reel/Story
permissions, current response shape or successful live publication. The Meta
publishing guide was unavailable during this check. Do not clear live gates or
infer Story endpoints from these declarations.

The old helper still lacks canonical durable child recovery and explicit local
receipt-persistence reporting. Its parent deletion write now uses expected-state
CAS; the returned deletion status describes the explicit remote receipt, not a
guarantee that both local projections committed. A canonical recovery service
must retain and reconcile those facts without resending.


## Batch91: audited native status proof recovery

Batch91 implements the private recovery path and local schema; customer native
publishing remains unavailable. It adds an
append-only workspace-owned proof ledger, identity/Page-checked final Video/Reel
GET observations, a private Root confirmation tied to the displayed revision,
short parent-first fencing/acceptance transactions and atomic normalized audits.
Accepted proof is required by the installed outcome/erasure guards; a confirmed
child flag alone is insufficient. Root/API/installation MCP reuse the same module
action service; workspace clients retain no Root authority. Native customer
formats stay unavailable and `facebook.native.statusRecoveryEnabled` defaults
false. Graph100/sub33 and Story objects never prove publication or absence.

Root setting construction and acceptance hold app_settings SHARE only during
short local transactions, covering absent/default setting rows and avoiding a
mixed/ABA trust snapshot during transport construction. Final acceptance also
locks the current source and selected Page while rechecking policy/grants/token.
No database row locks are held by those short transactions during the remote GET;
the existing outer workspace/post/target authority remains in force. Proofs from
changed revisions or lost credentials are retained as observations, never reused
as dispatch authority. Parent publication projection stays separate.

The additive migration is
`20261019040000_rebuild_facebook_native_status_proofs`, currently SHA256
`253e8fb4f18b4cf60fcce16702772dd166358e641fb875c2781cb84d8dc767d4`.
Its15-column ledger has three cascading workspace/parent/child FKs, immutable
updates, active Root observer validation, scoped accepted-revision uniqueness and
the shared purge gate. Root observer and original publication author are distinct.
All new PostgreSQL identifier names fit the63-byte identifier limit.

Both Claude accounts reviewed the source and findings were checked. The pre-GET
revoked-authority observation was improved so stale credentials cannot trigger a
provider read. The complete local full suite passed 3,136 tests across 355 files,
with zero skips, including 26 actual PostgreSQL journal/recovery cases (14 plus
12). A complete 20-file schema-only backup/restore rehearsal passed. The migration
was applied locally only after full backup and scratch-restore verification;
106 prior table counts/settings were preserved and the proof ledger is the 107th
table. This rehearsal does not establish production-shaped service/media/customer
rollback.

The production build and typecheck passed. The real built-server probe passed
Root API/installation-MCP authorization and eight desktop/phone views across four
themes. It made exactly two provider-like HTTPS mock GETs: browser accepted proof
for a published object and MCP held a scheduled observation. Anonymous, ordinary
workspace, cross-origin and key-based Root access were denied; wrong confirmation
made no GET; evidence remained visible with the platform and recovery flag off.
Fixtures, settings and audits were restored. Screenshot inspection found and
fixed Cancel wrapping at390px using a single-column shared-dialog action footer.
The final build/typecheck and complete eight-view probe passed again, including
an explicit one-line Cancel check; the corrected phone screenshot was inspected.
No live Meta request or production change occurred. Native formats, Story support,
deletion, host integration, first comments and live-provider gates remain open.


Batch92 integrates this proof path with the neutral `submitted` receipt state.
A submitted native parent retains its exact final identity while Root obtains a
current accepted proof. Matching external attestation and local projection remain
separate confirmed actions; wrong IDs and absence are refused. Actual PostgreSQL
and built-server installation-MCP tests exercised the complete chain without any
new provider write. The response-byte ceiling participates in current transport
trust revalidation. See [ASYNC_PUBLICATION_RECEIPTS.md](ASYNC_PUBLICATION_RECEIPTS.md)
for exact evidence and remaining automatic host/status/comment/deletion gates.


## Batch96 status reads for host-dispatched formats

The adapter's `getRemoteStatus` accepts the `video` and `reel` format ids only
while the private switch `facebook.native.publishingEnabled` is on. A Reel is read
with the Reel mapper (`mapFacebookVideoStatus('reel', …)`), so a ready video whose
`publishing_phase` is not `complete` stays unknown and is never projected as
published; a native video uses the video mapper. A scheduled provider answer is
`scheduled` and does not confirm publication. If the switch is turned off while
native posts are in flight, their status reads are refused (held) rather than
guessed. Evidence is mocked fetch only; no live Graph read was made.


## Batch97 Story status

The adapter reads a Story through the Page's Stories edge and the canonical read
proof does the same by final post id (`mapFacebookStoryStatus`). Positive only for
one exact published entry; not listed, archived, malformed, ambiguous or Graph100/
sub33 answers stay `unknown` and never prove absence. Story recovery eligibility
requires the complete confirmed chain and exactly the staged media id plus the final
Story id; the additive migration `20261030100000_rebuild_facebook_native_story_proofs`
widens the proof ledger accordingly and is not applied anywhere. The endpoint and
fields are unverified against live Graph (mocked tests only). Stories declare no
first comment or deletion. Reels now declare first comment and deletion through the
format-blind shared paths; live behavior is unverified. See FACEBOOK_NATIVE_FORMATS.md.


## Batch99 schedule child operations

`:cancel` and `:reschedule:<unix>` attempt rows (see FACEBOOK_NATIVE_FORMATS.md, Batch99)
are child operations: reconciliation returns their stored state and never reads Graph for them.
Cancel/reschedule write only after a read shows Facebook reports the video as scheduled. Mocked
fetch only; the full list of items needing live Meta verification is in FACEBOOK_NATIVE_FORMATS.md.


## Batch98 deletion and comment gating

The adapter now refuses Story and unknown format ids for first comments and remote
deletion before any request, validates the remote id shape, and confirms a deletion
only on an explicit boolean `success: true`. Native video/Reel deletion remains
allowed with the private switch off; a native comment needs it. Shared callers must
still pass `formatId`; see FACEBOOK_NATIVE_FORMATS.md (Batch98). Mocked fetch only.


## Batch100 Story readback

The shared native status helper reads Stories through the Page's Stories edge (one read, exact final
id, no polling), so reconciliation of Story attempts is no longer `readback_unsupported`. Results other
than an exact published entry are `unknown`; a read never confirms or mutates an attempt. Mocked fetch
only. See FACEBOOK_NATIVE_FORMATS.md (Batch100).


## Batch102 schedule-change journal

Cancel/reschedule child operations are now persisted by `formats/schedule-journal.ts` in their own
tenant-bound table; status reconciliation still reads those child ids as child operations, never as
publications. Static and validation tests pass; the PostgreSQL proof is written but not yet run, and the
migration is unapplied. See FACEBOOK_NATIVE_FORMATS.md (Batch102).
