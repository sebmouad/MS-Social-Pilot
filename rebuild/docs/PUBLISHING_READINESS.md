# Publishing credential readiness — 2026-10-17

Status: implemented local preflight and single-photo identity correction;
not complete Facebook coverage or live provider verification.

## Ownership and behavior

`modules/publishing/server/credentials.ts` resolves a credential only on the
server. It requires a connected, locally unexpired/non-revoked source, a
decryptable nonempty destination token, and the selected adapter's operation
policy. It returns no credential to the browser or MCP projection. Provider
scope names remain exclusively inside the platform module/configuration.

Facebook declares nonempty `meta.postPublishScopes` and `meta.postDeleteScopes`
in its manifest. Registry version 45 exposes both under the Facebook Root
module, using existing validation, encryption/audit/configuration services.
Their default `pages_manage_posts` is an operator policy, not proof of current
provider approval. The runtime supplies those policies to the adapter and
includes them, status-read and first-comment policies in the deduplicated OAuth
request. Missing/empty policies or insufficient recorded grants fail closed.

The adapter repeats grant checks at publishing, remote deletion, status-read
and first-comment entry points before transport. Low-level engine helpers are
module-owned transport seams; they do not establish product authorization.
Shared product callers use the configured adapter and current service guards.

Publishing lifecycle checks readiness before claiming publication intent.
Missing grants, expired/revoked connections, missing/empty/corrupt tokens and
policy errors cannot start a create request. An ineligible destination becomes
failed, with no remote ID and no publication journal entry. Other independently
eligible destinations retain their existing behavior. Local draft authoring
does not claim that a remote credential is currently usable.

First comments, remote deletion and manual status refresh reuse the same
credential resolver with their own operation policies. Remote deletion rejects
unready destinations before its intent and preserves the local post. Existing
uncertain operation recovery remains governed by its journal, not by a new
credential check or automatic resend.

`server/publishing/destinations.ts` projects readiness for composer/edit/import
and already-authorized MCP destination IDs. It also checks Publishing feature
availability, selected connection, platform entitlement, module capability and
target kind. MCP `list_pages` and `msp://targets` retain their bounded selected
resource metadata but replace stored `canPublish` with this current result.
Publishing pickers offer ready choices only; selected stored history remains
readable under its existing read authorization, independently of write grants.

For a single photo, Facebook's explicit valid `post_id` becomes the publication
identity. A malformed explicit `post_id` is an ambiguous success and must not
fall back silently. Only an absent `post_id` retains the existing photo-ID
fallback. This change does not prove live Graph response behavior.

## Evidence and boundaries

Regression failures reproduced missing-grant/expired publication, stale picker
readiness, missing adapter entry-point checks, and stale MCP capability output
before their respective fixes. Tests cover receipt identity, grant policies,
OAuth union, direct operation denial without transport, detached adapter calls,
credential parsing/crypto failures and current feature availability. Actual
PostgreSQL integration checks assert zero publication intents for four locally
unready credential states.

`scripts/verify-publishing-readiness.ts` makes real authenticated HTTP/MCP
requests to a guarded loopback preview database/application. Its disposable
synthetic source has no publishing/deletion grant and no usable remote token.
It verifies tool/resource readiness, local publication rejection before intent,
retained readable history and remote deletion rejection before intent with the
post preserved. Cleanup first revokes the temporary key, then inspects both
journals. Unexpected operation evidence retains the synthetic post, destination
and source with their IDs for investigation; it never removes recovery parents.
With no evidence it removes and verifies disposable source, target, post and
key. `REBUILD_PREVIEW_INTERACTIVE=1` optionally holds that fixture for browser
inspection; Enter continues cleanup. No remote content is created. A separate
controlled local test fabricated one uncertain intent, proved retention/key
revocation, then removed only that known fabricated evidence and its fixtures.

PREVIEW_QA.md records browser checks, final suite/build results and private log
locations. This does not prove current Meta approval, token validity at Meta,
per-resource task eligibility, successful create/status/delete, all formats,
multipart upload cleanup, automatic reconciliation or production readiness.
Locally recorded grants can become stale remotely. Multi-photo intermediate
uploads still need durable step receipts/cleanup. Local video, Reels, Stories
and native scheduling remain incomplete; see LEGACY_CAPABILITY_PARITY.md.
