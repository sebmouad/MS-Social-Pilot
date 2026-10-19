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
`native-config.ts` remain unverified defaults and are not registered Root controls.
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
   The SQL in `store.ts` is a proposal only; caller-prefixed operation IDs are not
   tenant isolation. Do not apply or register that table as a production design.
4. Integrate existing publication/deletion/first-comment recovery guards. Never
   create a parallel side-effect path bypassing current authorization or claims.
5. UI/API/MCP authorization, realistic local examples, responsive theme checks,
   live provider receipts and cleaned test content before availability.

Keep the held photo-cleanup canary untouched. Production remains legacy.
