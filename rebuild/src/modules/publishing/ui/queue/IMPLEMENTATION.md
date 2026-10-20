# Queue rescheduling

The queue now offers Reschedule for an author or manager with Publishing write
access when every destination is pending without a remote ID and a saved time
exists. The service remains authoritative if state changes after rendering.
Shared fields and validation collect a workspace-local date/time; useConfirm
reviews the post and old/new time with exact confirmation. Invalid future/DST
wall times are refused before dispatch and checked again by the service.

The control calls `/api/publishing/posts/bulk` with one post, action `reschedule`
and `RESCHEDULE 1 POSTS`. HTTP and MCP `bulk_post_action` use `runBulkPostAction`,
which reloads authorization and workspace time zone and calls `reschedulePost`.
That guarded lifecycle service enforces current scope/ownership, still-local
state, future time, retained versions and atomic audit. The UI verifies both
aggregate and matching per-item receipts; skipped, failed, uncertain or malformed
results retain the chosen time and confirmation. English/French copy follows the
document language. No new Root keys, migration or provider-specific shared rule.

Evidence: `tests/pubinbox-gap-ui.test.ts` covers success, skipped/malformed
receipts, DST rejection, confirmation/cancellation and French copy.
`tests/pubinbox-gap-surfaces.test.ts` executes HTTP and MCP through the bulk
service and verifies the workspace zone and worker-claim conflict. Existing
reschedule/guard tests cover lifecycle restrictions. These are synthetic and
mock persistence/provider boundaries. Browser themes/viewports, PostgreSQL and
actual MCP transport remain unverified; no server was run. The parity inventory
was deliberately left unchanged for this branch batch.
