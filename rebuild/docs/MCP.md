# MCP

The rebuild exposes a stateless MCP endpoint at `/api/mcp` using JSON-RPC over HTTP POST. It implements initialization, ping, tool listing and calls, and resource listing and reads. Notifications receive HTTP 202 without a JSON-RPC body. GET is authenticated and returns 405 because server-sent event streams are not implemented.

## Authentication and scope

Requests may use the rebuild app's `msp_session` browser session cookie or an `Authorization: Bearer mcp_…` API key. Cookie requests keep their `sp_workspace` selection and existing owner/admin fallback. Bearer keys are fixed to the workspace where they were issued and act as their creator, who must remain an enabled member. Owners and admins create and revoke keys at `/settings/mcp`; each key has explicit read and write feature scopes, an expiry, and a last-used timestamp. The full token appears only in the create response and is stored as a SHA-256 hash. Root settings `mcp.enabled`, `mcp.authenticatedRoles`, `mcp.maxRequestBytes`, `mcp.keys.maxActivePerWorkspace`, `mcp.keys.maxLifetimeDays`, and `mcp.keys.requestsPerMinute` are enforced. Current workspace entitlements, role permissions, and channel scope continue to apply in addition to the key's grants. Writes to connection selections and ad-account inventory remain restricted to owners and admins.

API keys do not create browser sessions and never expose social credentials or access tokens. Root controls the request body size, request budgets, and maximum items in list responses. Rate counters reset on process restart and are not shared across replicas.

## Tools

- `list_pages`: enabled destinations in the current workspace.
- `list_posts`: workspace posts with optional status and scheduled-date filters.
- `list_inbox`: synced conversations and comments with optional type and resolution filters.
- `reply_to_inbox`: reply to a synced Facebook conversation or comment. This contacts Facebook and requires `REPLY <message|comment> <id>`.
- `set_inbox_resolved`: resolve or reopen a synced Facebook conversation or comment. Requires `RESOLVE <message|comment> <id>` or `REOPEN <message|comment> <id>`.
- `moderate_inbox_comment`: hide or unhide a synced Facebook comment. This contacts Facebook and requires `HIDE COMMENT <id>` or `UNHIDE COMMENT <id>`.
- `get_page_analytics`: stored daily insights for a Page in the current workspace.
- `list_ad_accounts`: advertising accounts in the current workspace.
- `create_draft`, `update_draft`, `delete_draft`: operate only on local, unpublished, unconnected drafts through the same server mutations as the UI. They do not schedule, publish, or contact providers. Each call requires an exact confirmation value: `CREATE DRAFT`, `UPDATE DRAFT <postId>`, or `DELETE DRAFT <postId>`. Delete is permanent.
- `publish_post`: publish an existing post immediately to its configured destinations. This contacts providers and requires `PUBLISH POST <postId>`.
- `sync_post_status`: refresh a post's status from providers and update local publishing state. Requires `SYNC POST STATUS <postId>`.
- `delete_post`: permanently remove a post and its local publishing history. `deleteRemote: false` requires `DELETE POST <postId> LOCAL`; `deleteRemote: true` requires `DELETE POST <postId> REMOTE` and requests deletion at every supported provider before removing local records. Only owners, admins, and editors can request remote deletion; the lifecycle mutation enforces membership, authorship, provider capability, and connection validity.
- `set_connection_selection`: enable or disable one workspace channel or ad account through the UI's existing selection mutation. Confirmation must exactly match `SET CONNECTION <target|adAccount> <id> <ENABLED|DISABLED>`. The underlying mutation checks current membership, source validity, and workspace ownership, and records an audit event.

Key creation and revocation, and all MCP writes, create a `root_activities` audit entry with actor and workspace identifiers; write records include the tool and affected record identifiers. Inbox actions also keep their existing operation-specific audit event and verify the actor's current membership, Inbox feature access, Page scope, Facebook connection state, and configured token scopes. Token values and token hashes are never included in audit details. Tools are filtered by current workspace entitlements and key grants; unknown or denied actions fail closed.

The resources `msp://workspace`, `msp://targets`, `msp://posts`, and `msp://inbox` expose workspace-scoped JSON. Posts and inbox resources return bounded recent records.

## Parity boundaries

The legacy MCP used bearer API keys with read/write scopes and included post scheduling, approval, cancellation and request-changes operations; inbox resolve/assign operations; queue and template reads; attention summaries; and richer analytics. The rebuild exposes reusable publishing lifecycle operations for immediate publishing, status sync, and local or remote post deletion, plus Inbox replies, resolution, and comment moderation. Scheduling, approval, cancellation, assignment, queue and template reads, attention summaries and richer analytics remain unavailable through MCP. MCP write confirmations are explicit tool arguments, not an interactive human approval UI; clients should obtain user approval before repeating a write call with the required confirmation string.
