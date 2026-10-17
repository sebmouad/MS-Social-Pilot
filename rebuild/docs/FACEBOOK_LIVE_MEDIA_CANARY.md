# Facebook live media canary — batch 55, 2026-10-17

## Scope and actual result

The user selected Cuisine Pleine d’Envie for identifiable temporary test content.
The reviewed rebuild engine uploaded two generated 640×480 PNGs, committed both
photo receipts to a private host-side file journal, published one uniquely
labelled feed post and committed its receipt. Signed Graph readback confirmed
the post was published and both photos referred to that exact feed identity.
Deleting the feed returned the engine's explicit successful deletion result.

The run is **not fully passed**. Subsequent photo reads failed; the initial canary
did not issue photo DELETE requests or infer their absence. Cleanup is
`held_photo_cleanup`. Its private ledger and per-Page lock remain on the host;
another canary on this Page is refused. No unknown write is automatically retried.

A separate read-only investigation revalidated the Page token identity and
current publishing grant. Exact ID-only reads returned Graph HTTP 400/code
100/subcode 33 for both photos, and HTTP 400/code 10 for the feed. The first
uploaded-photos page returned HTTP 200 and four identities, containing neither
test photo. These observations do not independently prove deletion: unavailable
objects and filtered lists may also reflect provider access rules. They do not
justify weakening the production cleanup guards or releasing the test lock.

A separate, explicitly scoped test-content cleanup then made the **first**
DELETE request for each exact generated photo ID. It required the same Page and
grant, a matching retained lock, both original upload receipts, original exact
photo/feed association readback, the confirmed feed DELETE and proof no prior
photo DELETE had been attempted. Before each request, it fsynced intent into the
private ledger and retained its original snapshot. Both requests returned Graph
HTTP 400/code 100/subcode 33, yielding zero explicit photo-delete receipts. They
are recorded as unconfirmed and will not be resent. The ledger and lock remain;
the production Root cleanup policy and its stricter preflight were not changed.

The unauthenticated test browser could not inspect the Facebook Page. Access to
the user's local Chrome was disabled in Work settings; the user said they will
enable it. Authenticated visual cleanup verification remains pending. Official
Photo and Pages-post documentation fetches returned HTTP 429; no cascade or
absence guarantee is asserted from secondary documentation.

This was an **engine-only legacy credential bridge**, not a deployed rebuild,
Root-configured runtime, database-journal test or live UI/API/MCP publication.
Credentials were decrypted only on the authorized server. The legacy database
was queried read-only; production settings, schema, queues, services and proxy
were unchanged. Legacy loopback port 3100 and public health returned HTTP 200.
No first comment, remote video, native format, Inbox or Ads write was tested.

## Reproducible operator tool

`scripts/verify-facebook-live-media.mjs` is an import-safe operator verifier.
Its deterministic PNG fixtures are generated in memory; it fetches no external
asset and copies no customer media. Every photo/feed intent and receipt is
fsynced before the next provider phase. Cleanup uses a separate uncancelled
engine. Only the run's exact recorded IDs may be used; an uncertain feed blocks
photo cleanup, and every photo intent must be settled before completion.

The tool validates the current selected Page, stored connection, Page-token
identity, current grants, pinned engine/default files and HTTPS Graph origin.
The private ledger parent and per-run directories must be owner-only. A hashed
Page lock is acquired exclusively before the last prior-ledger check and remains
until fully verified cleanup. It does not expire automatically. Read-only
reconciliation is safe; rerunning the publisher is not a recovery mechanism.

An explicit feed DELETE receipt must precede photo cleanup. Each photo then
requires an exact identity, `can_delete:true` and no positive/malformed story
association. Missing/null story is accepted only within this explicitly scoped
disposable-media test; it is not interpreted as proof of absence or continued
unused state. The production Root policy remains separate and default-off.
No prior started/uncertain DELETE is resent. Full finalization additionally
requires both photo deletion receipts and successful publication/association
readback; it removes only its verified ledger and empty run directory, then
releases its owned Page lock.

Required private execution inputs:

- `MSP_FACEBOOK_MEDIA_CANARY_EXECUTE=YES`.
- `MSP_FACEBOOK_MEDIA_CANARY_PAGE_ID` and exact `MSP_FACEBOOK_MEDIA_CANARY_PAGE_NAME`.
- `MSP_FACEBOOK_MEDIA_CANARY_ACK=POST_AND_CLEANUP_TEMPORARY_MEDIA_ON_PAGE_<Page ID>`.
- `MSP_FACEBOOK_MEDIA_FIXTURE_ACK=USE_GENERATED_CANARY_IMAGES_ONLY`.
- `MSP_FACEBOOK_PROBE_APP_ROOT`, `MSP_FACEBOOK_PROBE_DIR` and `MSP_FACEBOOK_MEDIA_LEDGER_PARENT`: explicit absolute operator paths.
- `MSP_FACEBOOK_PROBE_GRAPH_ORIGIN`: the reviewed HTTPS Graph origin.
- `MSP_FACEBOOK_MEDIA_ENGINE_SHA256` and `MSP_FACEBOOK_MEDIA_DEFAULTS_SHA256`.

The private probe directory contains `socialpilot-facebook-engine54.mjs`,
`socialpilot-facebook-defaults54.json` and the reviewed verifier. The numeric
filenames denote the engine baseline, not a registry change. Bundle
`src/platforms/facebook/publishing.ts` using esbuild's Node ESM target. Export
only the public `FacebookConfig` registry defaults; omit the app secret. The
host loads its existing endpoint/version/timeout and app secret in memory.
Execute Node from the legacy root using its environment file and installed
`tsx`. Never display that environment or copy credentials off the host.

Executed hashes:

| Artifact | SHA-256 |
| --- | --- |
| Engine bundle | `f98beeb3a664d90bdcb2a591a3755e74c959c40986a68f94089e3d4965b2d259` |
| Public defaults | `c3e7fca289170ed9524916137c46d57313b99c55316d649c983eebcfef6d8a20` |
| Verifier | `4c8382d794d3aa4f15d09b82fab189c0c759f38c52da3b769b27007224fb487b` |

## Local checks and remaining recovery

Twelve synthetic filesystem tests cover receipt ordering, unknown outcomes,
exact identities, no-repeat DELETE, Page concurrency, lock retention and strict
finalization. The complete guarded suite passed 1,486 tests in 223 files.
PREVIEW_QA.md records final type/build evidence and subsequent recovery updates.
This does not close complete Facebook/legacy/MCP parity or any cutover gate.

The unresolved record is retained privately at
`/root/socialpilot-rebuild-canary-ledgers/2453cc2b-328e-48a3-8199-525efb282925/run.json`.
Its corresponding hashed Page lock remains beside the run directories. Temporary
nonsecret probe files remain at `/tmp/socialpilot-media55-3kdilqlk` for this
investigation. Preserve the ledger and lock until an explicitly documented,
externally verified resolution. Do not delete evidence to make the canary pass.
