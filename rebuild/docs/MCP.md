# MCP

The rebuild exposes a stateless MCP endpoint at `/api/mcp` using JSON-RPC over HTTP POST. It implements initialization, ping, tool listing and calls, and resource listing and reads. Notifications receive HTTP 202 without a JSON-RPC body. GET is authenticated and returns 405 because server-sent event streams are not implemented.

## Authentication and scope

Requests use the rebuild app's `msp_session` browser session cookie. The session must be valid, non-pending, unexpired, and attached to an enabled user. The `sp_workspace` cookie selects the workspace, with the existing owner/admin fallback when no selection matches. Root settings `mcp.enabled`, `mcp.authenticatedRoles`, and `mcp.maxRequestBytes` are enforced by the route. Each selected membership is checked again by the reused mutation helpers where applicable, and all reads and writes are constrained to the selected workspace. Current module and feature entitlements and scoped member permissions filter tool discovery and are checked again on calls and resource reads. Channel-limited members see only assigned destinations, posts, inbox items, and Page insights. Writes to connection selections and ad-account inventory remain restricted to owners and admins.

The rebuild has no API-key table or safely mappable API-key hash/scope workflow in its available Prisma schema. MCP therefore does not accept bearer API keys or create sessions. It never exposes social credentials or access tokens. Root controls the request body size, a per-process request limit, and the maximum items in list responses. The rate counter resets on process restart and is not shared across replicas.

## Tools

- `list_pages`: enabled destinations in the current workspace.
- `list_posts`: workspace posts with optional status and scheduled-date filters.
- `list_inbox`: synced conversations and comments with optional type and resolution filters.
- `get_page_analytics`: stored daily insights for a Page in the current workspace.
- `list_ad_accounts`: advertising accounts in the current workspace.
- `create_draft`, `update_draft`, `delete_draft`: operate only on local, unpublished, unconnected drafts through the same server mutations as the UI. They do not schedule, publish, or contact providers. Each call requires an exact confirmation value: `CREATE DRAFT`, `UPDATE DRAFT <postId>`, or `DELETE DRAFT <postId>`. Delete is permanent.
- `set_connection_selection`: enable or disable one workspace channel or ad account through the UI's existing selection mutation. Confirmation must exactly match `SET CONNECTION <target|adAccount> <id> <ENABLED|DISABLED>`. The underlying mutation checks current membership, source validity, and workspace ownership, and records an audit event.

All MCP writes create a `root_activities` audit entry with actor, workspace, tool, and affected record identifiers. The operation-specific mutation also applies its existing authorization checks. Tools are filtered by current workspace entitlements; unknown or denied actions fail closed.

The resources `msp://workspace`, `msp://targets`, `msp://posts`, and `msp://inbox` expose workspace-scoped JSON. Posts and inbox resources return bounded recent records.

## Parity boundaries

The legacy MCP used bearer API keys with read/write scopes and included post scheduling, approval, cancellation and request-changes operations; inbox resolve/assign operations; queue and template reads; attention summaries; and richer analytics. The rebuild schema or reusable server mutations do not currently support those operations, so they are not advertised. MCP write confirmations are explicit tool arguments, not an interactive human approval UI; clients should obtain user approval before repeating a write call with the required confirmation string.
