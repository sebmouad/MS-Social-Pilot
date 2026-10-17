# Facebook multi-photo staging evidence

2026-10-17, batch 52. Durable intermediate photo/feed intents and receipts are
implemented locally. Cleanup and resolution of unknown staged uploads are still
required. This is not complete Facebook recovery or approval for a live canary.

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
Recorded photos are settled only with a recorded feed receipt for that operation.
A confirmed feed does not itself prove completion of the parent's local record.

Customer and Root manual publication outcomes call the same module hook. ABSENT
cannot override a recorded feed or unassociated/unknown uploads. PUBLISHED must
match a recorded feed and complete ordered photo evidence when steps exist.
A matching durable feed can finish the existing local recovery path without
sending provider content. Recovery messages stay customer-safe; technical step
identities are private in-app Root evidence. The scoped owner data export also
includes retained content-free journal rows through workspace-FK discovery.

**Remaining implementation:** explicit known-photo cleanup with its own durable
DELETE intent/receipt; uncertain upload/feed outcome reconciliation; scoped human
step attestation and delayed-result conflict handling; cleanup jobs/history UX;
and real provider create/status/delete proof with verified cleanup. Until those
exist, failed staged uploads can remain held. Do not clear them by database edits,
parent absence attestation, elapsed-time assumptions, or an automatic retry.

## Root, API, MCP and configuration

The evidence table sits inside Root > Platform modules > Facebook. Its operation
ID GET filter and reset live in the existing contextual sidebar. The shared table
consumes module-owned columns; empty, invalid-filter, unavailable and truncated
states are distinct. Limits still apply after filtering. No customer settings
menu, third navigation layer or working-looking cleanup button was introduced.

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
Browser verification remains pending workspace-credit refill. Production legacy,
provider data, deployment, worker ownership and customer credentials were unchanged.
The official protocol reference pages are [Page Photos](https://developers.facebook.com/docs/graph-api/reference/page/photos/),
[Page Feed](https://developers.facebook.com/docs/graph-api/reference/page/feed/)
and [Photo](https://developers.facebook.com/docs/graph-api/reference/photo/).
No provider lifetime or expiry assumption is used to claim remote cleanup.
