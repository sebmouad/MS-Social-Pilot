# Facebook native transport and Root policy

Batch87 adds a real transport dependency and operator controls. It does not enable
native customer formats, claim live Meta delivery, or complete the Facebook engine.

## Ownership and behavior

`src/platforms/facebook/formats/transport.ts` owns Graph and resumable-upload
requests. It reuses Facebook configuration, request signing and provider error
classification. It pins copied configuration and upload trust for an operation,
rejects Graph traversal/auth-field overrides and configured endpoint query or
fragment ambiguity, refuses credential redirects, and bounds JSON reads including
stalled response bodies. Provider bodies, tokens and secrets are withheld from
errors. Ambiguous outcomes remain ambiguous; there are no automatic retries.
An empty deletion response is not an explicit deletion receipt.

Upload addresses must match an exact Root-approved HTTPS origin and the isolated
provider upload path. Root is an intentional credential trust boundary, as with
the configurable Graph endpoint; no provider-independent core knows Meta hosts.
Remote file URLs require canonical HTTPS, probed size metadata and the configured
ceiling. Binary uploads validate and copy bytes before dispatch. OAuth upload
headers remain distinct from appsecret_proof on normal Graph requests. Metadata
alone does not prove a remote file remains unchanged: trusted media probing and
binding to a durable publication operation remain integration requirements.

Provider protocol references:
[Meta's Reels collection](https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api)
and [Meta's Page API specification](https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Page.json).
The developer-site guides returned HTTP429 during this batch. Neither source
replaces version-specific contract checks and live provider receipts.

## Root controls and diagnostics

Registry76 registers25 Facebook-owned native settings:22 existing format policy
entries and3 transport controls (`uploadOrigins`, `maxUploadBytes`,
`maxResponseBytes`). All are labelled configured with customer runtime wiring
pending. The shared Root module surface, API and installation-scoped MCP expose
them with existing authorization, validation and value-free versioned auditing.
They are absent from customer module setup instructions.

`configuredFacebookNativeSettings` reads one validated non-secret snapshot and
checks related duration/aspect/schedule limits. The private transport factory
requires signing material when signing is enabled. Root's new native-policy
check validates this local policy without a connection or provider request. It
explicitly states that native formats remain unavailable. Individual Root writes
use entry schemas; cross-field consistency is checked by this policy consumer
and diagnostic, rather than by an atomic multi-setting editor.

Root settings search headings and technical keys now wrap at narrow widths. The
fix addresses an actual390px browser overflow; it does not hide page overflow or
change table scroll ownership.

## Evidence and remaining integration

Targeted transport tests cover signed Graph verbs, exact upload trust, metadata
and byte limits, immutable input snapshots, malformed/oversized/stalled responses,
redirect refusal, explicit success receipts and cancellation without retries.
Separate Node HTTP tests exercise actual localhost sockets and request encoding;
these are synthetic protocol tests, not live Meta proof.

The old unscoped SQL attempt store in `formats/store.ts` remains an unregistered
proposal and must not be applied. `rebuild_publication_attempts` is the sole
publication claim authority. Next integration must add Facebook-owned phase
receipts bound to its workspace/operation/publication/target, payload identity and
current fencing/locks, with export/erasure and actual PostgreSQL concurrency
coverage. Then integrate media probing, native dispatch, readback, first-comment
and deletion recovery through existing authorized services. Native availability
requires UI/API/MCP and cleaned live-provider evidence. The held photo-cleanup
canary and production remain unchanged.


Final batch87 evidence:2,980 tests in346 files, zero skips, with guarded synthetic PostgreSQL and real localhost HTTP sockets. Final typecheck and production build passed. Actual local API/MCP and Chromium checks passed Root ownership, exact write confirmations, invalid/cross-origin denial, workspace-scope denial, schema76 auditing, native-policy diagnostics without provider reads, and desktop Nightfall/phone Grove viewport fit after long-key wrapping. Temporary Root settings restored byte-for-byte including timestamps, sessions and scoped test audits cleaned. Two lower-cost native agents contributed storage investigation/transport/wire tests; both Claude accounts supplied independent reviews. Findings corrected include body deadlines, pinned configuration, metadata/byte validation, missing-signing refusal and honest consumption status. Static whole-worktree premium audit remains34 findings; this batch does not clear unrelated UI. No provider write, migration or production deployment occurred.
