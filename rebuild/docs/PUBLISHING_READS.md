# Shared Publishing reads

Implemented in the rebuild; full Publishing and release parity remain open.

`modules/publishing/server/read.ts` rechecks the active account, membership,
requested feature read permission, workspace state and current channel grants.
Caller constraints intersect current grants. Posts, Queue, Approvals, Calendar,
Home publishing counts, HTTP Posts and MCP post lists/resources use this service.
The composer/import/edit and sidebar channel choices reuse the same selected
Publishing resource resolver.

`read-scope.ts` selects enabled channels on non-revoked connections in the same
workspace. Only enabled installed adapters with publishing implementation,
supported resource kind and current workspace platform entitlement qualify.
Token expiry and the channel's current write grant do not erase stored history.
They still affect publish readiness separately. Product logic contains no
provider IDs, scopes or resource-kind rules.

Visibility is a whole-post rule: a destination-bound post needs at least one
visible destination and every destination must be visible. A mixed selected /
unselected or permitted / unpermitted post is excluded in full. This preserves
the existing channel-scope policy and avoids previews or actions that hide part
of their actual scope. Counts and page queries use that same predicate before
pagination. Retained data is not deleted; reselecting its eligible channels
restores visibility. Data export remains a separate authorized archive path.

Readers with unrestricted channel permission retain the existing workspace-wide
view of unconnected drafts. Restricted channel readers see only their own
unconnected drafts. Role/authorship checks for writes are separate; a read does
not grant authority to edit or delete another author's post.

Unavailable channel URL values produce zero matches and explicit feedback.
Shared native select options retain the unavailable choice instead of silently
showing All. Reset and other route controls remain in the sidebar / phone drawer.
The native popup owns Escape before the drawer on engines exposing `:open`;
handled/composing key events are respected. Older engines without native popup
state need separate compatibility verification.

Registry 43 adds consumed Root controls: `publishing.postPageSize` (50 by
default, 1–100), `publishing.readMaxItems` (200, 1–1000) and
`publishing.calendarMaxRangeDays` (70, 50–366). These control actual queries.
MCP uses a bounded list with validated statuses, channel ID and inclusive
scheduledAt ISO date bounds. A bounded list is not a complete archive. The new
no-store HTTP `GET /api/publishing/posts` accepts page, status and channel once
each; unknown/repeated parameters fail safely. First-comment provider error text
is redacted before serialization.

There is no schema migration or provider write in this batch. Synthetic local
PostgreSQL, HTTP/MCP and browser evidence belongs in PREVIEW_QA.md. Remaining
work includes a dedicated retained-data browsing experience, complete read/API
pagination parity, high-volume calendar behavior, comprehensive cross-browser
and theme accessibility, durable publication receipt recovery, full legacy /
Facebook / MCP / Root coverage, live-provider and cutover gates. The planned
publication work is described separately in PUBLICATION_RECOVERY_PLAN.md.
