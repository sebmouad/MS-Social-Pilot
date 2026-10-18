# Saved queue times and post placement — batch 71

Status: integrated local queue allocation. This is not completed content mix,
recycling, native-format coverage, live Facebook delivery or production cutover.

## Operation and ownership

The Publishing module owns weekly shared/channel timetables and the neutral slot
allocator. The host's `server/publishing/queue.ts` applies the ordinary publishing
validation and operation guards, then allocates and saves under the same workspace
advisory key used by timetable replacement. Shared times apply to every selected
channel; a channel-specific additional time is valid for a multi-channel post only
when every destination has that time. Calendar times use the current workspace
zone and skip nonexistent daylight-saving times. Occupied channel minutes include
scheduled, approval-pending and publishing posts.

The strict HTTP and MCP request is `{postId, confirmation: "QUEUE POST <id>"}`.
Current queue and posts-write permissions, role/author, whole-post resource scope,
selected destinations, media/content/first-comment compatibility and the local
unpublished state are checked. The mutation locks/rechecks the current actor and
workspace scheduling policy, records pre/post versions, changes the scheduled time
and timezone, and audits atomically. Contributor approval requirements produce
`pending_approval`, not an automatically publishable post. No provider is contacted.
No-slot failure leaves the draft unchanged. The existing delivery worker retains
its current author/destination authorization; the owner-based automatic-sync
policy does not silently grant publishing rights.

Per-destination publishing locks are deliberately fail-fast. Concurrent placements
can return a clear conflict; after checking that the conflicted post is unchanged,
a retry allocates the next free time. Unknown outcomes are not blindly retried.

Registry 64 activates queue timetable/lookahead bounds and adds the typed
`publishing.queue.defaultSlot`. Root controls the editor's initial day/time without
changing saved schedules. The private host registers the real queue marker for
customer pages, queue-slot HTTP and workspace MCP. Feature and permission checks
still determine what is visible/usable.

## UX

Posts expose Add to queue only for eligible editable posts with pending local
destinations and the required permissions. Review identifies the post/destinations;
success reports the actual assigned time and any outstanding approval. Failures
stay open for correction/retry and duplicate submissions are blocked.

The timetable selector lives in the existing contextual sidebar/drawer. Per-scope
unsaved slot/add-field drafts survive scope changes. Empty/invalid times have
field-linked feedback and cannot silently add the default time. Review names the
timetable and proposed slots; internal confirmation identifiers are sent by the
application after the explicit save action, rather than transcribed by customers.
Existing scheduled posts retain their assigned time when a timetable changes.

## Verification and recovery incident

Focused service/component tests cover validation, authority, approvals, no slots,
lock compatibility, affected-row checks, cleared times, per-scope drafts and
pending saves. Independent source review found no remaining important issue in
service/HTTP/MCP/permission wiring. The isolated staged-source batch passed 2,148 tests in 279 files, production
build and subsequent serial typecheck. The final guarded actual local probe also passed, including a Root default
change consumed as 13:45 in the authenticated editor HTML with workspace timezone.
All ten captured Root settings and synthetic audit rows were restored exactly;
five temporary drafts and their related fixtures were removed.
Chrome confirmed sidebar timetable choice, scope-switch draft retention/discard
and a 390px-wide phone layout. The optional strict static audit runner was removed
from the installed plugins during this batch and could not be rerun; no fresh
whole-project static-audit pass is claimed.

The real probe verifies HTTP/MCP slot reads/writes and post placement, current
scope/confirmation/read-only refusals, no-slot immutability, distinct allocation
under concurrent conflict-and-retry, approval hold, history/audits and no publication.
The final runs restore the captured controlled baseline and verify exact cleanup.

Initial probing exposed an inner `FOR UPDATE` workspace lock conflicting with
`withWorkspaceOperation`'s outer `FOR SHARE` lock. It is now compatible `FOR SHARE`.
Two interrupted test runs bypassed cleanup and lost their in-memory prior setting
snapshots. Their exact pre-test settings could not be recovered: no claim of exact
restoration applies to those interrupted runs. Before cleanup, a private preview
backup was restored into a scratch database; users/workspaces/posts/settings/audit
counts and configuration checksum matched. Only the confirmed local preview server
was stopped to release orphan transactions. Both run fixtures were removed and a
new audited, typed, explicitly enabled synthetic preview baseline was verified.
Production was untouched. CUTOVER.md records the backup evidence.

The hardened probe persists a private mode-0600 recovery ledger before writes,
uses bounded abortable requests and graceful signal cleanup, and removes the
ledger only after verifying fixture and exact captured-setting restoration. Its
successful normal execution is proven; arbitrary process-kill recovery is not.

## Remaining limits

Full phone/theme/keyboard/offline/stale/route-leave-draft coverage is unfinished.
Scope-switch draft preservation does not establish unsaved-navigation protection
across the whole app. Content mix/recycling remain hidden until their workers use
lifecycle-safe validation, approval, history and current job authorization. Real
Facebook delivery, complete legacy parity, production-shaped migration and exact
release rollback/cutover checks remain open. Production remains legacy.
