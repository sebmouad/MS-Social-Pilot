# Facebook multi-photo staging evidence

2026-10-17, batches 52–53. Durable intermediate photo/feed intents and receipts
and an opt-in, explicitly confirmed Root cleanup action for known staged photos
are implemented locally. Unknown uploads/feed outcomes and live provider proof
remain unfinished. This is not complete Facebook recovery or cutover approval.

## Module ownership and dispatch

Facebook owns `media-journal-port.ts`, `media-journal.ts`, `media-recovery-host.ts`
and the multi-photo protocol in `publishing.ts`. Configured engines and adapters
inject the journal factory; a multi-photo request without its opaque Publishing
operation ID fails before transport. Pure engine protocol fixtures may omit the
factory. Customer/shared services never issue Graph photo requests or interpret
photo phases. `server/platforms/publication-recovery.ts` explicitly registers the
installed module's safety/evidence hooks without importing or constructing its
API engine. Safety remains available when customer module access is disabled.

One independent committed step precedes every remote photo upload. The returned
photo ID must validate and commit before the next image. Only the exact ordered
set of recorded photo IDs can open the feed step; feed intent commits before
that request and its returned post ID commits before the engine returns. A step
cannot be dispatched again from an existing intent. Photo additions after any
feed intent and duplicate known identities for a destination are refused.
No automatic upload/feed resend or remote cleanup is performed.

The journal copies workspace/post/post-target/destination/actor binding from a
currently started Facebook publication and verifies its remote Page identity.
It stores no media URL, post text, file bytes, tokens or raw provider responses.
Every step transition rechecks the parent under a lock, uses the current shared
Publishing transaction duration/acquisition limits, and commits independently of
the parent service's final receipt projection.

| Step state | Meaning |
| --- | --- |
| started | Intent committed; a crash, cancellation or missing receipt stays held |
| recorded | Valid remote identity committed with receipt time |
| rejected | A recognized definite Graph rejection committed without an identity |
| uncertain | Reserved held state; current engine preserves started on ambiguity |

## Partial effects and recovery boundaries

A definite rejection of the **first** photo can release the parent only after
its rejection step commits: no earlier upload exists. Any later photo/feed
failure is uncertain at the parent boundary, even when Graph explicitly rejected
that later request. An earlier photo may exist and must remain recoverable.
Unknown/malformed responses and photo/feed receipt-write faults stop sequencing.
No following upload/feed request is sent after that failure.

Installed module safety hooks stop new claims and destination/workspace cleanup
while staged or unknown evidence remains, including when a legacy parent state
was separately resolved. Workspace-owned journal data is included by the existing
FK-discovery export/count/erasure machinery; the safety gate runs before erasure.
Recorded photos are settled with a recorded feed receipt for that operation or
a matching confirmed photo deletion receipt. Unknown deletions stay held.
A confirmed feed does not itself prove completion of the parent's local record.

Customer and Root manual publication outcomes call the same module hook. ABSENT
cannot override a recorded feed or unassociated/unknown uploads. PUBLISHED must
match a recorded feed and complete ordered photo evidence when steps exist.
A matching durable feed can finish the existing local recovery path without
sending provider content. Recovery messages stay customer-safe; technical step
identities are private in-app Root evidence. The scoped owner data export also
includes retained content-free journal rows through workspace-FK discovery.

**Remaining implementation:** uncertain upload/feed/delete outcome reconciliation; scoped human
step attestation and delayed-result conflict handling; cleanup jobs/history UX;
and real provider create/status/delete proof with verified cleanup. Until those
exist, failed staged uploads can remain held. Do not clear them by database edits,
parent absence attestation, elapsed-time assumptions, or an automatic retry.

## Root, API, MCP and configuration

The evidence table sits inside Root > Platform modules > Facebook. Its operation
ID GET filter and reset live in the existing contextual sidebar. The shared table
consumes module-owned columns; empty, invalid-filter, unavailable and truncated
states are distinct. Limits still apply after filtering. No customer settings
menu or third navigation layer was introduced. Implemented cleanup actions use
module-owned metadata and the shared exact-confirmation dialog described below.

Private GET `/api/root/platform-publication-evidence` accepts one provider ID,
optional operation ID and bounded result cap; every response is no-store.
Installation MCP tool `get_root_platform_publication_evidence` and resource
`msp://root/platform-publication-evidence` share the current active-owner service.
The resource aggregates installed modules within a total cap; modules without a
hook are omitted. Workspace ownership or API keys never confer Root authority.

Registry 49 adds consumed, validated `root.platformEvidenceLimit` (default 100,
1–1000) and Facebook-owned `meta.mediaHistoryLimit` (default 100, 1–1000).
Effective limits also honor the MCP result ceiling. Saved Root changes apply at
read time with existing config audit/history. Database identifier bounds (2048),
phase names and ordinal integrity bound (20 photos, matching the maximum permitted
Root media setting) are isolated structural invariants, not unexposed operational
switches. New protocol/database shapes require code and a reviewed migration.

## Migration and evidence

The sixth checksum-pinned migration is
`20261017020000_rebuild_facebook_media_steps`. CUTOVER.md records restore-verified
backups, exact 98/99-table counts, preview-only application and remaining cutover
gates. The compatibility Prisma schema is not a migration source; the journal
uses parameterized SQL, and no db push/migrate deploy was run.

PREVIEW_QA.md records automated, real PostgreSQL and actual local HTTP/MCP checks.
The HTTP/MCP probe injects fake Graph responses and does not contact Facebook.
Representative Root phone/desktop browser checks passed after normal approval
recovered; the complete browser matrix remains open. Production legacy,
provider data, deployment, worker ownership and customer credentials were unchanged.
The official protocol reference pages are [Page Photos](https://developers.facebook.com/docs/graph-api/reference/page/photos/),
[Page Feed](https://developers.facebook.com/docs/graph-api/reference/page/feed/)
and [Photo](https://developers.facebook.com/docs/graph-api/reference/photo/).
No provider lifetime or expiry assumption is used to claim remote cleanup.

## Explicit known staged-photo cleanup — batch 53

This is a manual operator action with a known limitation: Meta's Photo node
documentation says `page_story_id` may be absent on published photos. Neither
an absent/null field, `can_delete`, nor the original `published=false` upload
proves that a photo remains unused. DELETE has no documented atomic
"only if unused" precondition. The app cannot close an external attachment race.

For that reason `meta.manualMediaCleanupEnabled` defaults to **false**. Root must
explicitly opt in, externally check the photo, acknowledge that limitation for
each action, and type `DELETE STAGED PHOTO <media-step-id>`. The action appears
under Root > Platform modules > Facebook only for a recorded known photo with
no feed intent, or a definitively rejected feed. Started/unknown/recorded feed
steps and any known projected post identity are refused. A fresh Graph read
requires the exact photo ID and explicit `can_delete=true`; a positive, empty
present or malformed story value blocks deletion. An omitted/null story field
is accepted only within the stated manual policy, never as proof of absence.

Facebook owns `media-cleanup.ts`, `media-cleanup-transport.ts` and its pure
transport port. Shared Root owns generic validation/dispatch, module metadata
rendering and publication/workspace/target/active-owner locking. Step bindings
are cross-checked against their parent before scope construction and again under
the parent lock. A started parent is frozen to uncertain in the independently
committed deletion intent, preventing a late engine from starting a feed.
Existing known/unknown remote effects never trigger automatic cleanup or resend.

The independent content-free `rebuild_facebook_media_deletions` table stores an
immutable workspace/step/operation/destination/actor/remote-photo binding. It has
only a workspace FK, preserving evidence across local object removal. An active
or confirmed deletion is unique per workspace/step; rejected history is retained.
Intent and domain audit commit before any provider IO. Current policy, target
identity, decryptable token, connection validity/expiry and both scope policies
are checked before intent and again in the callback. A fresh read precedes DELETE.

| Deletion state | Meaning and next action |
| --- | --- |
| started | Durable intent; missing receipt remains held and cannot be resent |
| confirmed | Exact DELETE returned `success=true` and receipt/audit committed; replay returns the same local receipt without provider IO |
| rejected | No DELETE was sent, or a recognized definite Graph rejection was received; another explicitly confirmed action may be attempted after review |
| uncertain | A dispatched DELETE lacked reliable confirmation; no repeat is allowed |

Malformed/false success, transport errors/cancellation after dispatch, and
receipt-write failures do not report success. A failed receipt write leaves its
started intent held. Known cleaned photos can be settled while other unknown
steps remain held. Cleaning photos does not automatically attest publication
absence or release a publication retry: use the existing explicit Root outcome
flow only after all module evidence permits it. Unknown photo/feed/delete
reconciliation and delayed effects still need implementation.

POST `/api/root/platform-publication-evidence` and installation MCP write tool
`run_root_platform_publication_action` call the same current-owner service and
module handler. Required input is providerId/actionId/subjectId/confirmation and
`acknowledged=true`; remote identities are derived from durable evidence, not
accepted from the caller. HTTP additionally requires same-origin requests.
Workspace keys and ordinary workspace owners cannot execute this Root action.
The existing read-only tool/resource includes safe current action metadata;
reading never executes it. The generic dialog keeps input on errors, blocks
repeat after unknown/malformed receipts and refreshes evidence for review.

Registry 50 adds consumed Facebook-owned manual cleanup, read-scope and
delete-scope policies. The latter two default to `pages_read_engagement` and
`pages_manage_posts`, must be nonempty, and enter OAuth only when manual cleanup
is enabled. Configured/granted scope strings do not prove provider permission,
Page tasks or app-review readiness. Actual Graph read/DELETE authorization and
live permission compatibility remain to be verified. Existing proof signing and
Root Publishing operation/transaction budgets are reused.

The seventh checksum-pinned additive migration is
`20261017030000_rebuild_facebook_media_deletions`. CUTOVER.md records exact
99/100-table restore checks and preview-only application. The real HTTP/MCP
probe `scripts/verify-facebook-media-cleanup.ts` proves authorization, exact
confirmation, durable **synthetic** confirmed replay and unknown-result refusal;
it performs no provider deletion. Engine fixtures and guarded PostgreSQL fault
tests cover the dispatch and receipt chain separately. PREVIEW_QA.md records
full checks and explicitly pending browser/live-provider coverage.


## External outcome reports and immutable provenance — batch 54

Root can expose module-declared typed fields and read-only context resolved from
the evidence row. Shared Root bounds and renders those fields without interpreting
Facebook policy; the Facebook handler validates their meaning against current
locked evidence. Context such as resolved workspace/channel/Page/publication
identifiers is display-only and does not come back in the action request.

When `meta.manualMediaAttestationEnabled` is explicitly enabled, a private Root
operator can report an externally checked photo or feed ID, a step reported
absent, or a photo reported deleted/still present. These actions append immutable
content-free rows to `rebuild_facebook_media_resolutions` with source `operator`.
Late provider outcomes are stored as separate rows with source `provider`. These
resolution events are append-only during normal operation; authorized workspace
erasure may remove them with workspace data. The result state `attested` describes
a human report only; it does not confirm a provider response, cancel an in-flight
request, or prove that an unknown request will not complete later. Conflicting
outcomes are held for review; late provider evidence is retained separately and
does not by itself imply a conflict. No arbitrary Root resolution action, candidate
search or automatic retry/resend is provided.

A human report that a feed step is absent does not satisfy the cleanup gate.
Known-photo cleanup remains limited to a publication with no feed intent or a
definitively provider-rejected feed, and still requires the separate default-off
cleanup policy, external unused-photo check and per-action race acknowledgment.
An absent/null `page_story_id` is not proof that the photo is unattached.

Registry 51 adds the Facebook-owned, consumed
`meta.manualMediaAttestationEnabled` boolean (default `false`). This capability
adds a bounded manual evidence path; it does not finish unknown-step or delayed
receipt reconciliation, search for remote candidates, or provide live proof of
publication/deletion. PREVIEW_QA.md records the automated/local evidence and
remaining browser/provider work.

Batch 55 adds bounded real engine evidence for multi-photo publication/status
and feed deletion. Photo cleanup remains explicitly unresolved after unavailable
reads; no production cleanup guard was relaxed. The host-side operator journal
is separate from these application tables. See FACEBOOK_LIVE_MEDIA_CANARY.md
and PREVIEW_QA.md before treating the live canary as a complete passing test.
