# Facebook native status and recovery boundary

Status: batch90 hardens the private, unregistered status scaffold. Native customer
formats remain unavailable. Submission receipts, status observations, durable
publication confirmation and remote cleanup are separate facts.

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

## Required complete recovery

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
