# Integrations: outbound webhooks and the key-authenticated REST API

Status: **integrated slice, mocked-data tests only.** No PostgreSQL, browser, live receiver or live-provider run yet (see Limitations).
Module: `src/modules/integrations/` (a feature of the Settings product module; no separate module id). Screen `/settings/webhooks`. Feature id `settings/webhooks`.
Tests: `tests/integrations-services.test.ts`, `tests/integrations-access.test.ts`, `tests/integrations-module.test.ts` (no network, no database).

## What exists
- **Webhooks** (`server/webhooks.ts`): workspace owners/admins (with the `settings/webhooks` grant) create endpoints with an event selection, pause/resume, change events, delete, send a signed test ping, read the delivery log (paged) and send a settled delivery again (same delivery id). Signing secret: shown at creation and rotation, and again only through an explicit reveal (`POST /api/webhooks/[id]/secret/reveal`: write permission, exact confirmation `REVEAL WEBHOOK SECRET <id>`, audited before the value leaves the server, per-person hourly bound from Root). Secrets are stored with the shared AES envelope (`server/secret-crypto`), never logged, never in lists, audit rows or MCP results.
- **Signing**: `X-MSP-Signature: sha256=<HMAC-SHA256 of "<timestamp>.<body>">`, plus `X-MSP-Timestamp`, `X-MSP-Event` and a stable `X-MSP-Delivery` id for de-duplication. The timestamp is taken when the request is sent, not when it was claimed. `verifyWebhookSignature` compares in constant time.
- **SSRF**: every create and every send uses the shared guard (`modules/publishing/server/media/network/net-guard`: https only, no credentials, web ports, no internal names, every DNS answer public, optional Root host allowlist) and the shared address-pinning transport (`pinned-fetch`), which connects only to a validated address (closes DNS rebinding) and never follows redirects. The shared transport gained an optional `method: 'POST'` + `body` (additive; GET behaviour unchanged).
- **Delivery worker** (`deliverDueWebhooks`, job `webhooks`, schedule `integrations.webhooks.deliverySchedule`): shared worker lease per job, plus a per-row claim (`FOR UPDATE SKIP LOCKED` + lease), only the claimant may settle, retries on the Root backoff schedule (`retryDelaysSeconds`, default 1 min, 5 min, 30 min, 2 h, 12 h), then "gave up"; unsafe addresses never retry; retention purge. Idempotency: `emitWebhook` runs under an advisory lock keyed by event id and skips endpoints that already hold that `eventId`; a new endpoint never receives events older than itself.
- **Event sources** (`server/events.ts`, run by the delivery job each pass; Root: window `eventLookbackMinutes`, cap `eventScanLimit`). Every event is derived from durable state, only for workspaces with an enabled endpoint listening, with a stable id so overlapping scans queue each event once per endpoint (id check and insert share one advisory lock). Payloads carry ids and names, never post bodies.
  - `post.published` / `post.failed`: `post_targets` results; ids `post_target:<id>:published` / `post_target:<id>:failed:<attempts>`.
  - `post.scheduled`: Publishing audit rows `publishing.post_scheduled` and `publishing.post_approved`, reported only while the post is actually waiting or already past that state (a post held for approval, rejected or back in draft is not "scheduled"); id `post_scheduled:<auditId>`. A later reschedule is not reported.
  - `comment.received`: `post_comments` first seen (`firstSeenAt`) inside the window, excluding comments by the channel itself or sent from this app; id `comment:<id>`; author name and text capped (500). Read from stored rows; Inbox code is untouched and no platform is contacted.
  - `page.disconnected`: a connection with `invalidatedAt` inside the window, one event per channel; id `target:<id>:disconnected:<invalidatedAtMs>`, so a reconnect followed by a new disconnect is a new event.
  - `report.ready`: `report_runs` that finished `completed` or `partial`; id `report_run:<id>`; metadata only (kind, period, row count, status), never the report body or recipients. Failed, skipped and uncertain runs are not "ready".
  Limit: an event is only seen if the worker runs inside the lookback window after it happens (default 180 minutes); endpoints created after an event never receive it. All subscribable events now have a source, so the screen no longer marks any as not sent.
- **REST v1** (`server/rest.ts`, `/api/v1/*`): authenticated only by the scoped workspace API keys Settings already issues (`mcp_...`, hashed, expiring, feature grants + channel/ad-account ceiling). This module issues no keys. The shared bearer check (`server/mcp/bearer.ts`, extracted from the MCP route; `/api/mcp` now calls it too) re-reads the owner, role, plan and channel grants on every call, so a key can only narrow its owner: demotion, disabling, removal, expiry and revocation take effect at once; installation (Root) scope is not available here. Cookies are never read.
  - `GET /api/v1/me`: workspace, role, granted features, channel scope (no grant needed).
  - `GET /api/v1/pages`: channels inside the key ceiling (grant: `settings/connections` read).
  - `GET|POST /api/v1/webhooks`, `DELETE /api/v1/webhooks/[id]` (REST hooks for Zapier/Make/n8n; grant `settings/webhooks`, write for changes). A key sees and removes only hooks it created; a key restricted to selected channels is refused (events are workspace-wide); the key owner must still be an owner/admin. Hooks of a revoked or expired key are paused by the delivery job.
  - Per-key rate limit and per-address throttle for rejected credentials (Root `ratePerMinute`, `failedAuthPerMinute`); a valid request gives its throttle count back.
- **MCP** (`mcp.ts`, group `integrations-webhooks`): list/create/update/delete/rotate/test webhooks, list deliveries, redeliver. Workspace-wide (restricted keys refused), managers only, exact confirmations, audit receipts. **Secrets are never returned over MCP** (create and rotate say to show them in Settings). Secret reveal, API key issuance and OAuth are not tools: they would put a credential into an agent transcript or let one credential mint another. Resource `msp://settings/webhooks`.
- **Root config** (`config.ts`, 19 keys under `integrations.*`, registry 84): switches for the API and for webhooks, limits, retry waits, timeouts, lease, batch, retention, payload size, page size, scan window, host allowlist, delivery schedule, transaction bounds. All consumed.
- **Copy**: `copy.ts`, en + fr chosen from `accept-language` (same pattern as `modules/media/copy.ts`).
- **Audit**: `webhook.created|updated|deleted|secret_rotated|secret_revealed|tested|redelivered` in `activity_logs` (writes commit with their audit in one transaction; MCP also writes its receipt).

## Shared edits made (exact)
`modules/settings/manifest.ts` (page, job, `integrations.` prefix), `modules/installed-config.ts`, `modules/installed-mcp.ts`, `server/permissions/index.ts` + `server/entitlements/index.ts` (feature `settings/webhooks`, owner/admin only like `settings/mcp`), `scripts/worker.ts` (job `webhooks`), `server/mcp/bearer.ts` (new, extracted) and `app/api/mcp/route.ts` (uses it), `lib/config/registry.ts` (`CONFIG_SCHEMA_VERSION` 84) + `tests/config-validation.test.ts`, `tests/mcp-security.test.ts` (new feature id in a fixture), `publishing/.../net-guard.ts` + `pinned-fetch.ts` (optional POST).

## Dropped or deferred
- **Dropped (main already has it)**: the WIP notification preferences service/UI/MCP (`settings/notifications` exists) and the WIP `api_tokens` key issuance (needed an un-applied migration and duplicated `settings/mcp` keys).
- **OAuth connectors**: implemented, see "OAuth connectors for MCP clients" below.
- **REST v1 posts** (`GET|POST /api/v1/posts`, grant `publishing/posts`, write for POST). Implemented only through Publishing services via the seam `modules/publishing/server/api.ts` (`listPostsWithFirstComment`, shared with the MCP `list_posts` tool, and `createPostForApi`, a thin wrapper of the same `createPost` MCP uses), so the key's feature/channel ceilings, approval holds, format and media validation, versioning and audit apply identically. `GET` filters: `status` (comma list), `from`, `to`, `limit`, `q`, `channelId` (legacy `pages` accepts one id); unknown keys are refused. `POST` body (strict, zod, 256 KB cap): `message`, `targetIds` (1-50), optional `firstComment`, `firstCommentDelayMinutes`, `link`, `media`, `destinationFormats`, and `scheduledAt` (ISO with offset) to schedule instead of saving a draft. A workspace that requires approval answers `status: pending_approval, held: true`. A key limited to selected channels may only target those channels (the service refuses others). Writes leave an MCP-style audit receipt naming the key.
  - Not carried over: legacy had no get-one, delete or idempotency-key route/header, so none exist; a retried POST after a lost response creates a second draft, so check `GET` first. Update/cancel/publish stay on MCP and the app.

## Limitations and unverified
- Only mocked-database tests. SQL was checked by reading against `prisma/schema.prisma` (`webhook_endpoints`, `webhook_deliveries`, `post_targets`, `posts`, `targets`, `mcp_api_keys`, `activity_logs`); the idempotency lookup on `payload ->> 'eventId'` is unindexed (a functional index on `webhook_deliveries ("endpointId", (payload ->> 'eventId'))` is recommended before heavy use; not applied, no DDL was run).
- The default sender (shared pinned transport) is unit tested with a fake transport only; no live receiver was contacted.
- Rate limits and the reveal bound are in-process (`server/rate-limit`), not cross-process.
- Test pings and redeliveries send from the request thread (bounded by the Root timeout).
- The post-event scan reads `post_targets.updatedAt` without a dedicated index; it is bounded by window and size and limited to workspaces with a listening endpoint.
- No browser, theme or phone verification of `/settings/webhooks`.


## OAuth connectors for MCP clients

Lets an MCP client (such as Claude) connect without a pasted key. Code: `modules/integrations/oauth/**`, routes `app/oauth/authorize`, `app/api/oauth/{register,token,authorize}`, `app/.well-known/oauth-authorization-server` and `oauth-protected-resource/[[...path]]`. Off by default.

**Flow.** Discovery (RFC 8414 and RFC 9728 for `/api/mcp`) -> dynamic client registration (RFC 7591, public clients, `token_endpoint_auth_method: none`) -> `/oauth/authorize` consent screen -> `POST /api/oauth/authorize` -> redirect with a one-time `code` (plus the client's `state` and `iss`) -> `POST /api/oauth/token` (`authorization_code` + PKCE `S256` verifier) -> an ordinary scoped `mcp_api_keys` row made by `issueMcpKey` (the same service as Settings, MCP API keys), so `server/mcp/bearer.ts` and every feature, channel and ad-account ceiling apply unchanged. There are **no refresh tokens** (legacy had none): the key ends at its expiry and the client asks again. The key is named `OAuth: <client>`, appears in Settings, MCP API keys and is revoked there like any other. Revoking it is the whole revocation story.

**Consent.** Signed-in workspace owners/admins with the Settings MCP write grant (`requireViewer({ feature: 'settings/mcp', write: true })`). Defaults to the narrowest scope: read on the features the person can use, no change access, "only the channels I choose" with none ticked; "all channels" is offered only to people whose own access is not channel-limited, and anything wider than read-only or selected resources goes through the shared `useConfirm` dialog. The decision is re-validated server side: same-origin `Origin` required (CSRF), workspace id must still be the viewer's current workspace, redirect exact match, features limited to the MCP workspace feature list and to the person's own access, resource ids limited to selected resources of this workspace. No Root scope exists in the flow. The exchange calls `issueMcpKey`, which re-reads the person's access, so a permission lost after consent refuses the exchange.

**Sign-in.** Sign-in code is not changed and has no return address. A signed-out visitor sees a sign-in link and reopens the connection link from the app afterwards (the client restarts the flow).

**Storage (migration `20261026100000_rebuild_oauth_connectors`, additive, not applied by this work).** `mcp_oauth_clients` (name, exact redirect URIs, last used) and `mcp_oauth_codes` (SHA-256 of the code, client, user, workspace, redirect, PKCE challenge, read/write features, resource scope, expiry, `usedAt`, issued `keyId`). Codes and keys are never stored in plain text. The legacy `OAuthClient`/`OAuthCode` tables are untouched.

**Security properties (each has a test in `tests/integrations-oauth.test.ts`).** Exact redirect match at registration-time shape rules (https, or http on loopback; no fragment, credentials or wildcard), at consent and at exchange; never a redirect to an unregistered address. PKCE `S256` only. Codes live `integrations.oauth.codeTtlSeconds` (default 60), are consumed by one atomic `UPDATE ... RETURNING` before any check (a wrong verifier burns the code), and presenting a used code revokes the key it produced. Constant-time comparison of client id, redirect and challenge. `state` is passed back unchanged. Client names are stripped of control/bidi characters. Rate limits: registrations per caller, token requests per client and address, consent decisions per person (in-process, like the rest of the module). Consent page is served with `frame-ancestors 'none'` (headers for `/oauth/:path*` in `next.config.ts`). Discovery and every endpoint answer unavailable while disabled or while no issuer is configured.

**Root settings** (`integrations.oauth.*`): `enabled` (false), `issuerUrl` (origin only; required, discovery is never derived from the request Host), `codeTtlSeconds`, `keyLifetimeDays` (capped by `mcp.keys.maxLifetimeDays`), `maxClients`, `clientIdleDays`, `registrationsPerHour`, `tokenAttemptsPerMinute`, `consentsPerHour`.

**Audit.** `root_activities`: `oauth.client_registered`. Workspace `activity_logs`: `oauth.consent_granted`, `oauth.consent_denied`, `oauth.token_issued`, `oauth.code_reuse_revoked`; key creation and manual revocation keep their existing `mcp.key_created` / `mcp.key_revoked` Root activities.

**Limitations.** Mocked-database tests only (no PostgreSQL, browser or real MCP client run). `/api/mcp` does not yet answer 401 with a `WWW-Authenticate: Bearer resource_metadata=...` header (not owned by this work); clients that probe `/.well-known/oauth-protected-resource` find it. A reuse racing in between key issuance and the `keyId` link cannot revoke (the key exists for milliseconds without the link). Rate limits are per process. Registered clients are anonymous (any caller may register); the consent screen shows the client name and the redirect host and users must recognise them. Key listing shows OAuth keys by name only (no separate origin column). The pinned cutover-rehearsal migration list was not extended.


## Analytics and Ads REST v1 parity (2026-10-21)

The module-owned MCP operations are also reachable at
`/api/v1/analytics/<operation>` and `/api/v1/ads/<operation>`.
Operation names and argument objects are identical to MCP. The table below lists
all current endpoints; `GET / POST` means either verb may invoke the read.
Writes accept POST only. POST reads support filters too large for a practical URL.

Authentication is `Authorization: Bearer mcp_…`, with the existing API enablement,
credential validation, current owner authority, rate limits and purge refusal.
The transport delegates to the **same MCP host and product services**: feature
read/write grants, independent channel/ad-account ceilings, manager checks,
workspace-wide scope refusals, availability, operation locks, exact confirmations,
idempotency and audit receipts are unchanged. No new key issuer or service rules.
Module declarations form the route allowlist; Root and other modules cannot be
invoked through either route family.

For GET, pass an optional URL-encoded JSON object in the single `input` query
parameter. For POST, send that object as the JSON body, without query parameters.
Unknown/repeated query parameters, malformed JSON and non-object inputs are
refused. For example:

```text
GET /api/v1/analytics/get_analytics_overview?input=%7B%22compare%22%3A%22previous%22%7D
POST /api/v1/ads/preview_ads_change
{"adAccountId":"example-account","operation":{"type":"status.set","objectType":"campaign","objectId":"example-campaign","status":"paused"}}
```

Repeat the returned exact confirmation with the same reviewed operation and a
stable `requestId` at `POST /api/v1/ads/apply_ads_change`. Preserve that request ID
after a lost response, inspect changes, and never automatically resend an unknown
outcome. Successful bodies are the MCP structured result directly (including
`previousPoints`, series/breakdown pagination, CSV/JSON/HTML export strings and
audit receipts where that operation returns them). Service failures use their
HTTP operation status and retain safe metadata such as `attempt: not_dispatched`.
All responses use `Cache-Control: no-store`.

| Endpoint suffix | Method | Required feature |
| --- | --- | --- |
| `/api/v1/analytics/get_analytics_posts` | GET / POST | `analytics/posts` |
| `/api/v1/analytics/get_analytics_ad_objects` | GET / POST | `analytics/ads` |
| `/api/v1/analytics/export_analytics_report` | GET / POST | `analytics/reports` |
| `/api/v1/analytics/list_report_templates` | GET / POST | `analytics/reports` |
| `/api/v1/analytics/manage_report_template` | POST | `analytics/reports` |
| `/api/v1/analytics/list_report_schedules` | GET / POST | `analytics/reports` |
| `/api/v1/analytics/manage_report_schedule` | POST | `analytics/reports` |
| `/api/v1/analytics/list_report_runs` | GET / POST | `analytics/reports` |
| `/api/v1/analytics/generate_report` | POST | `analytics/reports` |
| `/api/v1/analytics/get_analytics_pins` | GET / POST | `analytics/pins` |
| `/api/v1/analytics/pin_analytics_metric` | POST | `analytics/pins` |
| `/api/v1/analytics/unpin_analytics_metric` | POST | `analytics/pins` |
| `/api/v1/analytics/reorder_analytics_pins` | POST | `analytics/pins` |
| `/api/v1/analytics/get_analytics_goals` | GET / POST | `analytics/goals` |
| `/api/v1/analytics/set_analytics_goals` | POST | `analytics/goals` |
| `/api/v1/analytics/get_analytics_demographics` | GET / POST | `analytics/demographics` |
| `/api/v1/analytics/compare_analytics` | GET / POST | `analytics/compare` |
| `/api/v1/analytics/get_analytics_explorer` | GET / POST | `analytics/explorer` |
| `/api/v1/analytics/get_analytics_overview` | GET / POST | `analytics/overview` |
| `/api/v1/analytics/get_analytics_metric_details` | GET / POST | `analytics/overview` |
| `/api/v1/ads/get_ads_report_rows` | GET / POST | `ads/campaigns` |
| `/api/v1/ads/export_ads_report` | GET / POST | `ads/campaigns` |
| `/api/v1/ads/list_ad_accounts` | GET / POST | `ads/campaigns` |
| `/api/v1/ads/get_ad_creation_options` | GET / POST | `ads/campaigns` |
| `/api/v1/ads/get_ads_performance` | GET / POST | `ads/campaigns` |
| `/api/v1/ads/get_live_ad_status` | GET / POST | `ads/campaigns` |
| `/api/v1/ads/create_ad_campaign` | POST | `ads/campaigns` |
| `/api/v1/ads/create_ad_set` | POST | `ads/campaigns` |
| `/api/v1/ads/update_ad` | POST | `ads/campaigns` |
| `/api/v1/ads/compare_ads_performance` | GET / POST | `ads/compare` |
| `/api/v1/ads/list_ads_objects` | GET / POST | `ads/objects` |
| `/api/v1/ads/get_ads_object` | GET / POST | `ads/objects` |
| `/api/v1/ads/get_ads_management_options` | GET / POST | `ads/campaigns` |
| `/api/v1/ads/get_ads_creative_image` | GET / POST | `ads/campaigns` |
| `/api/v1/ads/preview_ads_change` | GET / POST | `ads/campaigns` |
| `/api/v1/ads/apply_ads_change` | POST | `ads/campaigns` |
| `/api/v1/ads/list_ads_changes` | GET / POST | `ads/campaigns` |
| `/api/v1/ads/resolve_ads_change` | POST | `ads/campaigns` |
| `/api/v1/ads/list_ads_creatives` | GET / POST | `ads/campaigns` |
| `/api/v1/ads/list_ads_creative_sources` | GET / POST | `ads/campaigns` |

All result/range/export/management ceilings continue to come from the existing
Root settings and the key result cap. No new Root keys. Input bytes reuse
`integrations.api.postsBodyMaxBytes` for both GET JSON input and POST bodies;
its current Root label/help mention Posts only. The integrator should generalize
that label/help in `modules/integrations/config.ts` (outside this lane) to cover
all REST v1 JSON input. No configuration schema version change is needed here.

Verification: `integrations-v1-analytics-ads.test.ts` covers every declared endpoint
with transport/auth/grant/input/error/receipt tests (MCP dispatch mocked), plus
actual-host checks for restricted report scope, Ads manager access, Analytics
validation, snapshot previousPoints and missing Ads confirmation. Related account-scope/Ads management
unit tests cover the existing shared service paths. This is synthetic unit
verification, without server, PostgreSQL, browser, live provider or MCP transport
execution. The existing `mcp-security.test.ts` independently fails five Analytics
cases because its snapshot fixture omits the current `previousPoints` field;
that file is outside this lane. Update the fixture and re-run it during integration.
