# Facebook native formats: implementation status

Status: unavailable, unregistered source scaffold. No production, browser or live
provider evidence. `wired:false` is intentional. This is not feature completion.

## Provider evidence

The [official Meta Page API specification](https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Page.json)
declares `photo_stories`, `video_stories`, and `video_reels` creation edges.
Reel/video-Story declarations include `scheduled_publish_time`. Their presence
proves the declared API surface, not current application grants, version-specific
limits, supported deletion/readback, or successful execution. Do not infer that
Facebook cannot schedule those formats from the present planner's restrictions.
The scaffold implements only its existing video scheduling path.

The [official Meta Reels collection](https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api)
describes start, transfer, finish and status operations. Media limits in
`native-config.ts` remain unverified defaults; batch87 registers their Root controls
as configured, with customer runtime wiring pending.
[Groups API removal](https://developers.facebook.com/docs/graph-api/changelog/version19.0/)
means legacy Group publishing must not be advertised.

## Safety hardening, batch83

- Persist phase intent before dispatch and returned upload IDs before transfer or
  finish. Store failures stop subsequent remote writes. A repeated operation never
  automatically resends uncertain phases.
- Store final video/Story IDs before final settlement. Preserve known remote
  outcomes if a later audit write fails; final settlement uses a state guard.
- Require explicit Reel finish success and Story identities; uploaded video/photo
  IDs alone do not prove Story publication. Asynchronous video results require
  readback before any live-status claim.
- Direct video/photo byte-only paths are refused before network dispatch; an
  actual binary transport remains required. Resumable bytes require host proof.
- Unknown status shapes and inaccessible objects remain unknown. Graph100/sub33
  does not prove absence. Remote deletion requires explicit success; ambiguity
  remains held for reconciliation.
- Memory receipts are copied; proposed SQL stores phase snapshots. Neither the
  memory store nor a proposed SQL table constitutes a deployed durable engine.

## Verification

Batch83:53 targeted mocked tests; clean candidate full suite2918 tests/336 files,
zero skips using guarded local synthetic PostgreSQL; typecheck and production
build passed. Two native agents investigated/reviewed; both Claude accounts
completed independent read-only review. No new UI or provider operation was
exercised. Production and the held photo-cleanup canary were unchanged.

## Required next integration

1. Provider-neutral per-destination format metadata and persisted intent through
   composer, edit, duplicate, CSV, queue, status, deletion and MCP.
2. Facebook-owned signed transport, bounded uploads with validated destinations,
   media probing, verified version-specific contracts and Root configuration.
3. Reviewed migration with workspace/target/publication binding, payload identity,
   leases/fencing, erasure/export coverage and real PostgreSQL concurrency checks.
   Batch89 replaces the unscoped proposal with a bound private journal; this
   milestone alone does not enable formats or complete the native engine.
4. Integrate existing publication/deletion/first-comment recovery guards. Never
   create a parallel side-effect path bypassing current authorization or claims.
5. UI/API/MCP authorization, realistic local examples, responsive theme checks,
   live provider receipts and cleaned test content before availability.

Keep the held photo-cleanup canary untouched. Production remains legacy.

## Batch84: neutral catalog and legacy intent bridge

The shared adapter contract now declares opaque format IDs, customer labels,
media support, first-comment/status/delete support and independent application/
native scheduling support. Shared validation accepts text-only modules, strips
undeclared metadata, rejects duplicate/malformed catalogs and never substitutes
an unknown explicit format. Destination catalogs validate their default and
isolate a broken declaration to that destination; operation flags reflect current
credential grants. The same safe metadata reaches MCP tools and target resources.
Facebook declares only its implemented feed format. Its label is consumed from
Root `meta.feedFormatLabel` (registry75). No native capability was enabled.

The thin Prisma mapping now reads the existing legacy `posts.format` column.
This adds no database column or migration. Guarded publication passes that stored
identity unchanged; shared preflight validates every pending destination before
any claim. Scheduling/rescheduling/queue and duplication validate stored intent;
duplication preserves it. Both adapter and direct Facebook publisher reject an
unsupported format before transport. An old Reel/Story is never silently sent
as a feed post. Unsupported legacy data is retained for future integration.

This is a transitional legacy bridge: `posts.format` is still one post-level
legacy value with its existing database default. It is not the final independent
per-destination intent model. New authoring, CSV, templates, exports and format
selection still need the complete neutral per-destination contract and storage
migration; do not infer future-provider compatibility from the legacy bridge.
There is no new format picker or native scheduling UI in this batch.

Evidence:2932 tests/337 files, zero skips with guarded local synthetic PostgreSQL;
production build and typecheck passed. Tests include actual duplicate persistence
and guarded opaque-format dispatch, pre-claim rejection, isolated malformed
catalogs, credential narrowing and MCP tool/resource projection. Both Claude
accounts reviewed; their preflight/catalog defects were corrected. The MCP suite
passed again with the final projection assertions (140 tests). No new browser or
live provider proof is claimed. Existing production remains legacy.


## Batch85 continuation

Per-destination intent now replaces the global bridge for newly selected targets across composer, editing, CSV, lifecycle, automation, copies, snapshots, exports and MCP. Historical null targets retain the bridge. This completes host intent storage, not Facebook native engine coverage: native dispatch, format-aware status/deletion/comment routing and real provider verification remain required before advertising additional formats.


## Batch87 native transport and Root policy

Signed Facebook-owned Graph/resumable transport and registry76 native controls are implemented. Twenty-five native settings are grouped under Facebook and labelled configured; customer dispatch remains unwired. A local Root diagnostic validates one native configuration snapshot and cross-field limits without provider requests. The private constructor refuses missing required signing material. Real loopback HTTP tests verify encoding/signatures, response bounds and timeouts. See FACEBOOK_NATIVE_TRANSPORT.md. Root phone verification identified a long-search-heading overflow; shared settings heading/key wrapping fixes it.

The full objective stays active. Do not register the unscoped SQL proposal or treat this transport as complete native delivery. Keep the existing parent publication journal as the sole claim authority; next implement tenant-bound child phase receipts, payload identity/fencing, export/erasure and PostgreSQL concurrency checks, then native dispatch/status/comment/deletion and live cleanup. Production and the held photo-cleanup canary remain unchanged.


## Batch88: native payload and receipt safety

The Facebook executor snapshots the complete used payload before its first await,
including a copied Buffer/Uint8Array and probed metadata. A versioned SHA256
identity covers target, format, caption, schedule, source, bytes digest and media
metadata without storing raw content in the identity. Matching recorded hashes
refuse changed payloads under an existing operation; older hashless proposal
records return a conflict and remain held without dispatch. Remote URL identity is not proof that the
server will return immutable bytes. Host media probing/binding remains required.

Every checkpoint and final settlement requires an explicit true write result.
A provider success followed by failed/unconfirmed local settlement returns an
uncertain result and cannot invite automatic resend. Staged IDs remain in known
identities rather than becoming final publication IDs. Repeated phase IDs are
deduplicated while phase receipts remain intact. Unexpected execution errors
return a held outcome. Submission results use status:submitted, require readbackRequired:true and
return no invented permalink; only later verified status can prove live delivery.
The scaffold row state still uses its historical published value for a submission
receipt; consumers must not treat it as live status. Unsupported schedule/caption
fields, non-byte runtime values and unsupported direct uploads fail before
claiming an operation. Canonical HTTPS URLs are intentional, matching transport
validation; credentials/fragments and ambiguous normalization are refused.

Native formats remain unavailable. The existing unscoped SQL store is still an
unregistered proposal; its missing hash/tenant binding is not fixed by executor
snapshots. The next database batch must replace it with a tenant-bound fenced
child journal under the existing shared publication claim, integrate export/
erasure and recovery guards, and pass actual PostgreSQL concurrency and migration
backup/restore checks before application. No migration or provider write belongs
to batch88. Production and the held photo-cleanup canary remain unchanged.

Next journal gates: [FACEBOOK_NATIVE_JOURNAL_PLAN.md](FACEBOOK_NATIVE_JOURNAL_PLAN.md).

Final batch88 evidence: isolated database-enabled suite3015 tests/347 files, zero
skips; production build passed. Serial typecheck passed after that build.
Thirty-five new identity/receipt tests cover Buffer mutation, changed payloads,
hashless historical holds, malformed port replies, runtime byte types, metadata,
unsupported fields and failed final writes without resend. Both Claude accounts
completed independent reviews; a correction review confirmed the prior fixes.
The shared result is now submitted, distinct from verified live status. There
was no new UI/browser, live provider, migration-application or production evidence
in this batch. The local SQL proposal and its static test remain uncommitted and
unapplied, pending the journal integration gates. Full goal remains active.


## Batch89: scoped native receipts and Root evidence

Facebook now owns a tenant-bound, payload-bound durable phase journal beneath the
existing sole publication claim. Creator-only dispatch fencing, monotonic SQL
receipts, retained late facts, installed erasure/outcome guards and redacted export
are implemented; the unscoped SQL proposal is removed. Root/API/installation MCP
read bounded evidence even while the platform is disabled. Compact module-owned
summary columns and keyboard-accessible details replace the identifier-heavy
Root table; filters remain in the contextual sidebar.

The19th migration is applied only locally after full backup/scratch restore and
PostgreSQL checks; all105 prior table counts and Root settings were preserved.
The complete19-file schema-only rehearsal passed. See
[FACEBOOK_NATIVE_JOURNAL_PLAN.md](FACEBOOK_NATIVE_JOURNAL_PLAN.md) for ownership,
evidence and next integration gates. Native customer formats remain unavailable.
Actual host authorization/status/comment/deletion and audited native recovery,
live Meta coverage, remaining parity and production-shaped rollback stay open.
Production and the held photo-cleanup canary remain unchanged.

Final batch89 evidence: isolated synthetic PostgreSQL suite3059 tests/350 files,
zero skips; final production build and serial typecheck passed. Fourteen actual
PostgreSQL cases cover ownership/fencing, all four phase chains, retained late
facts, strict constraints/purge gates and real export/erasure. The complete19-file
schema-only rehearsal passed. Actual local HTTP/installation-MCP/Chromium checks
passed anonymous/workspace-owner/scope denial, fence/credential privacy, unknown
action/cross-origin refusal, evidence visibility while Facebook is disabled and
eight Grove/Coast/Clay/Nightfall desktop1440/phone390 views. Receipt details open
by keyboard, filters stay in the drawer/sidebar and document width stays within
the viewport. All synthetic fixtures were removed; captured Root settings and
scoped configuration audits were restored exactly. Lower-cost agents implemented
SQL/recovery/UI slices; both Claude accounts supplied independent source reviews.

The local preview is the isolated final build at localhost:3200. Complete native
host authorization, verified status/comment/deletion, audited process-loss/native
conflict recovery, cleaned live provider coverage and broader legacy/configuration/
production rollback gates remain open. No live provider request or production
deployment occurred. Whole-app UX/accessibility is not cleared by this matrix.


## Batch96: native host integration for video and Reel (private, default off)

Facebook now dispatches **Video post** (stored bytes or remote URL, optional
provider-held schedule) and **Reel** (stored bytes or guarded remote snapshot)
through the canonical shared publish service and the batch89 durable journal.
Everything provider-specific lives in `platforms/facebook/**`:

- `formats/publish.ts` — `createFacebookNativePublisher`: probes media (trusted
  metadata comes only from `inspectMediaSnapshot` / `resolveRemoteMediaSnapshot`,
  never from the caller), plans with the Root `facebook.native.*` policy, then
  calls `executeFacebookNativeWithJournal` bound to the shared claim's workspace,
  post, destination, actor and operation id. Pre-dispatch validation throws a
  definite rejection (claim released, nothing sent); anything that may have
  reached Facebook, journal unavailability, payload conflicts and rejections that
  left staged objects throw an ambiguous error (claim held, never resent). A
  success is `state: 'submitted'`, never `published`; the existing submitted
  reconciliation proves live status.
- `publishing.ts` — the adapter declares `video` (native schedule, first comment,
  status, delete as for feed video) and `reel` (status only; no first comment or
  delete) **only** while the private switch is on; with it off the catalog is the
  unchanged feed format and native ids are refused. `getStatus` takes an optional
  `nativeFormat` so a Reel is read with the Reel mapper (requires
  `publishing_phase: complete`).
- `runtime.ts` — `configuredFacebookNativePublishing()` reads the switch and the
  validated native policy; an invalid policy fails closed (no native format).

Neutral hooks (no provider names in shared code): `PublishRequest.scheduledAt`
and `PublishRequest.publication` (shared claim identities for module journals) in
`platforms/types.ts`; `publishPost(actor, id, undefined, { nativeSchedule: true })`
may dispatch a future-scheduled post only when every pending destination's format
descriptor declares `scheduling.native`, passes the schedule instant, and leaves
the destination pending (`submitted`) for reconciliation. Without the option, or
for a format that does not declare native scheduling, behavior is unchanged.

Root keys (all in the Facebook module config): `facebook.native.publishingEnabled`
(default false), `facebook.native.videoFormatLabel`, `facebook.native.reelFormatLabel`.

Evidence: mocked Graph transport, in-memory attempt store and mocked shared
claim only (`facebook-native-publish-host.test.ts`, `publishing-native-schedule.test.ts`).
No PostgreSQL journal run for this path, no browser, no live Meta, no production.

Not done: stored **video** attachments cannot yet reach the adapter — shared
authoring/`resolvePublishMedia` resolve only stored images (`media:<id>`), so
`localFile` bytes for video need a shared media resolver (modules/media storage →
publishing attachments); there is no UI/HTTP/MCP entry that sets `nativeSchedule`;
Reel first comment and deletion, Stories, application of the switch to the composer
format picker, native-schedule cancel/reschedule at the provider, and live proof
remain open. Groups stay unsupported (API removed).


## Batch97: Story formats, Reel follow-ups and Story proof (private, default off)

Same private switch (`facebook.native.publishingEnabled`); mocked Graph transport
only. Nothing here is verified against live Graph. All code is in `platforms/facebook/**`.

- **Photo Story / Video Story** (`story_photo`, `story_video`) are declared by the
  adapter only while the switch is on, and `formats/publish.ts` dispatches them
  through the existing executor and the batch89 journal. A photo Story uploads the
  photo unpublished (stored bytes via the signed multipart port, or Facebook fetches
  a guarded remote HTTPS photo after the address-pinned probe) and then creates the
  Story from its photo id; a video Story uses the resumable phases. The result is
  `submitted` with the final Story post id (never the staged photo/video id).
- A Story is its media alone: a caption, link or schedule is refused before any
  claim or transport (definite rejection), as are the wrong media kind, several
  files and out-of-policy size/aspect/length. The Root `storyPhoto.*`/`storyVideo.*`
  limits already existed; the defaults are tall frames only (0.5-0.6 width/height).
  Stories declare no first comment, remote delete or native schedule; their media
  descriptors disable link, alt text and mixed media.
- The publisher's `inspect`/`resolveRemote` dependencies now take the media kind so
  photos are probed as images and videos as videos.
- **Reel** now declares first comment and remote delete. The adapter's shared
  comment/delete paths are format-blind (a Reel is a Video object, so the same
  comments edge and DELETE are used); the shared requests carry no format id.
  Comment dispatch still waits for confirmed publication, and delete keeps the
  shared durable intent/receipt/uncertain handling. Whether Facebook accepts both
  on a Reel is unverified until cleaned live coverage.
- **Story status** reads the Page's Stories edge (`<page>/stories?fields=post_id,
  status,creation_time`) and is positive only for exactly one entry whose `post_id`
  is the final Story id and whose status is published. Not listed (the edge is a
  bounded recent list and Stories expire), archived, malformed or ambiguous answers
  are `unknown`, never absent or failed; Graph100/sub33 is unknown. The older
  `readFacebookNativeStatus` scaffold still reports Stories as unsupported.
- **Story proof recovery.** Migration `20261030100000_rebuild_facebook_native_story_proofs`
  (additive, unapplied to any database) widens the proof ledger's format check and
  replaces the accepted-proof guard: a Story keeps two journal identities (staged
  media plus final Story), so accepted Story proof requires exactly those two, one of
  them the final id, and the complete confirmed chain (`photo_upload`,`story_create`
  or `upload_start`,`upload_transfer`,`story_finish`). Video and Reel keep the sole
  identity rule. `facebookNativeStatusEligible` and `readFacebookNativeProof` mirror
  it. As for Video/Reel, a Story submission projects as published only after Root
  accepts a current proof; automatic reads alone do not.

Root keys: `facebook.native.storyPhotoFormatLabel`, `facebook.native.storyVideoFormatLabel`
(both in `platforms/facebook/module.ts`; the registry schema version must be bumped by
the registry owner). The switch's label/description now mention Stories.

Evidence: `tests/facebook-native-story.test.ts` (dispatch of both Stories, refusals,
uncertain/no-resend, status mapper and adapter read, eligibility, Reel comment/delete,
static migration checks) plus the updated host and read-proof tests. No PostgreSQL run
of the new migration, no browser, no live Meta.

Open: apply and rehearse the migration (backup/scratch restore, pin it in
`scripts/cutover-rehearsal.sh`) and add PostgreSQL proof tests for Story acceptance;
shared stored-video resolution (still images only) so stored Reel/Story video bytes
reach the adapter; no UI/HTTP/MCP entry sets `nativeSchedule`; the shared comment and
delete requests should carry the format id so Reel-specific handling is possible;
cleaned live coverage for every native format.


## Batch98: format-aware comment and delete (private, default off)

Mocked transport only; nothing here is verified against live Graph.

- **Neutral request field.** `FirstCommentRequest` and `RemoteDeleteRequest` in
  `platforms/types.ts` gain an optional `formatId` (additive; shared callers that do
  not send it behave exactly as before).
- **Facebook gating** (`platforms/facebook/publishing.ts`, `assertFormatSupportsOperation`):
  feed (`post`), `video` and `reel` pass; `story_photo`/`story_video` and any unknown id
  are refused before credentials or transport (a Story declares neither operation and an
  unknown id never falls back to feed). A native **comment** also needs the private
  switch. Native **deletion** of an existing `video`/`reel` stays possible with the
  switch off so published content can still be removed; Stories never.
- **Deletion evidence.** `remoteId` must match the Graph id shape (no path/query
  characters, at most 128 characters). A deletion resolves only when Facebook answers
  an object with boolean `success: true`; `"true"`, `false`, an empty object, an array or
  any other body throws, so the shared durable deletion journal records it as uncertain
  and never resends. Graph100/sub33 is still not evidence of absence or deletion.
- **Composer exposure.** The catalog needed no new code: `video`, `reel`, `story_photo`
  and `story_video` already reach the neutral `availablePublishingFormats` projection
  (and so composer, MCP and API) only while `facebook.native.publishingEnabled` is on;
  a test now pins the five ids with the switch on and one with it off, and that Stories
  declare no first comment or remote delete.

Root keys: none new. Migration: none.

Still open: the shared callers must send the format. `modules/publishing/server/deletion.ts`
(`adapter.deleteRemote({ credential, remoteId, signal })`) and
`modules/publishing/server/first-comment.ts` (`adapter.publishFirstComment({ ... })`,
where `selectedFormat` is already resolved) need `formatId` passed through; until then
Facebook sees `undefined` and treats the call as feed, which is the previous behavior.
Shared stored-video resolution, `nativeSchedule` entry points, applying and rehearsing
migration `20261030100000`, PostgreSQL Story proof tests and cleaned live coverage for
every native format also remain open.


## Batch99: provider-held schedule cancel/reschedule and live-verification ledger (private, default off)

Mocked transport only; `platforms/facebook/formats/schedule.ts`, exported from the formats
index and not registered in the neutral catalog or any shared service.

- `cancelFacebookNativeSchedule(publishOperationId, deps)` and
  `rescheduleFacebookNativeSchedule(publishOperationId, newInstant, deps)` act only on a
  native **Video** whose parent attempt is `published`/`confirmed` with a valid final id.
  Reels, Stories, unpublished attempts and unsafe ids are refused before any request.
- Each reads first (one status read, no polling) and writes only when Facebook itself reports
  the object as scheduled; live, processing or unknown answers return `not_scheduled` with no write.
- Cancel is a DELETE of the held object, reschedule a POST of `published=false` plus
  `scheduled_publish_time`. A change is confirmed only by boolean `success: true`. The
  new instant must lie inside the Root `scheduleMinSeconds`/`scheduleMaxSeconds` window.
- Idempotency: child rows `<op>:cancel` and `<op>:reschedule:<unix>`; a repeat returns
  `already_attempted`, an unclear answer is settled by one readback and stays `uncertain`
  (never a second write). A definite Facebook refusal is `rejected`. If the attempt row cannot
  be written, nothing is sent. A confirmed cancel moves the parent to `deleted` by CAS.
- Status reconciliation now treats `:cancel` and `:reschedule:<unix>` rows as child operations
  (like `:comment`/`:delete`) and never reads them as publications. `guarded`/`record`
  moved to `formats/attempt-io.ts` with no behavior change.

Root keys: none. Migration: none. No customer surface calls these helpers yet.

Still open (host): the neutral adapter contract has no cancel/reschedule operation, so no
UI/HTTP/MCP entry exists; `modules/publishing/server/deletion.ts` and `first-comment.ts` still
need to pass `formatId`; shared stored-video resolution; migration `20261030100000` PostgreSQL
Story proof tests.

### Needs live Meta verification (nothing below is proven)

All Graph paths, fields and body shapes in the native engine come from SDK/spec declarations
and mocked tests. Before any native format is advertised, verify with identifiable test content
on a sandbox Page, inspect the result and clean up:

1. App review and granted scopes for Video, Reel and Story publishing, first comment, deletion.
2. Video: unpublished upload then publish, resumable `upload_phase` flow, `file_url` mode, and
   `scheduled_publish_time` limits (Root min/max defaults are unverified).
3. Reel: start/transfer/finish, `publishing_phase` values and `complete` meaning, schedule
   support (declared `native:false`), first comment and DELETE on a Reel.
4. Photo Story (`photo_stories` with unpublished photo id) and Video Story (`video_stories`
   phases); the `<page>/stories` edge fields and visibility window used for status; Story expiry.
5. Status fields: `status.video_status`, `published`, `scheduled_publish_time`; processing
   durations; Graph100/sub33 meaning; error codes classified as definite rejection.
6. Cancel (DELETE of a scheduled video) and reschedule (POST new time) success bodies, and
   whether a held video accepts a changed time.
7. Media limits (size, duration, aspect) in `native-config.ts` and the allowed upload origins.
8. Rate-limit/throttle headers and codes interpreted by `interpretFacebookThrottle`.
9. Comment and delete response shapes (`success: true`, comment `id`) per format.
