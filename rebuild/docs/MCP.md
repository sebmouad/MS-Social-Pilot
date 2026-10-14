# MCP

The rebuild exposes a read-only, stateless MCP endpoint at `/api/mcp` using JSON-RPC over HTTP POST. It implements MCP initialization, ping, tool listing and calls, plus resource listing and reads. Notifications receive HTTP 202 without a JSON-RPC body. GET is authenticated and returns 405 because server-sent event streams are not implemented.

## Authentication and scope

Requests use the rebuild app's existing `msp_session` browser session cookie. The session must be valid, non-pending, unexpired, and attached to an enabled user. The `sp_workspace` cookie selects the workspace, with the same owner/admin fallback used by the rebuild UI. As in the current UI, only owner/admin memberships are admitted while finer-grained role and page scopes remain unmapped. All queries are constrained to that selected workspace. MCP does not accept API keys, create sessions, or expose credentials/tokens.

## Tools

- `list_pages`: enabled workspace destinations (all supported channel types).
- `list_posts`: workspace posts, optionally filtered by status and scheduled date.
- `list_inbox`: synced conversation and comment records, optionally filtered by type and resolution state.
- `get_page_analytics`: stored daily insight rows for a Page in the selected workspace.

The resource URIs `msp://workspace`, `msp://targets`, `msp://posts`, and `msp://inbox` expose corresponding read-only JSON. Posts and inbox resources return recent records with bounded limits.

## Deliberately withheld

No write tools are exposed. The rebuild has no MCP/API-key write scope, and does not yet implement an MCP confirmation flow. Its current post and inbox data helpers are read-only; the rebuild's UI mutations do not provide enough support to safely reproduce legacy scheduling, approval, cancellation, resolution, or assignment operations through MCP. Queue slots, templates, attention summaries, and detailed analytics are also absent from the rebuild's mapped data model, so they are not advertised as tools.

## Legacy parity gaps

The legacy endpoint used bearer API keys with read/write scopes and offered create/update/cancel/approve/request-changes post tools, inbox resolve/assign tools, queue and template listing, attention summaries, and richer Page analytics. The rebuild intentionally provides only the read capabilities backed by its current schema and UI access gate. Its session-cookie authentication also means MCP clients must operate in an authenticated browser session; a dedicated token workflow is not yet available.
