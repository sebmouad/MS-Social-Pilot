# Deferred platform scheduling after a time change

Round 13: `reschedulePostToInstant` commits the time change and releases its
operation locks before re-entering the ordinary platform handoff service. This
applies to Calendar/Queue actions, session REST, REST v1 and MCP through their
existing shared lifecycle calls; no additional entry point is required.

When Root `publishing.remoteScheduling.offered` is true, a post whose stored
`publishMode` is native gets a fresh handoff attempt. The existing per-destination
mode, adapter format/lead-window checks, current authorization, approval checks,
publication journal and audit remain authoritative. Application choices stay
local, existing held copies are not recreated, and first comments wait for
confirmed publication. No new Root keys or schema version change.

The follow-up carries the committed instant into `publishPost`'s existing
expected-time guard. A concurrent move/cancel makes it skip. There is no nested
post lock. A follow-up failure does not undo or misreport the committed time
change; unknown provider effects retain their normal recovery state. The normal
publication handoff records its own audit independently of the time-change audit.

Evidence: `publishing-scheduling-verification.test.ts` uses mocked persistence,
operation guards and publication journaling. It checks too-soon/too-far moves,
still-deferred and application destinations, Root withdrawal, concurrent moves,
revoked membership, uncertain results and already-held copies. Existing remote
hold, reschedule, REST write and destination-mode tests provide regression checks.
These are not PostgreSQL locking, browser, real-client or live-provider evidence.

Integration documentation outside this lane: update ARCHITECTURE.md's scheduling
section and AGENT_HANDOFF.md with this behavior/evidence; remove the stale
"Rescheduling does not re-offer" gap from docs/PARITY_PUBLISHING_INBOX.md. Live
hold/reschedule verification and the independent periodic handoff job remain open.
