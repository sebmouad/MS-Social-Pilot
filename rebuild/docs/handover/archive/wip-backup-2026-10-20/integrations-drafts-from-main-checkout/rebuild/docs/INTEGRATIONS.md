# Integrations: notifications, webhooks, REST keys, OAuth connectors

Status: **source and mocked tests only. Not wired into the host.** Owner: worker A2-W7.
Source: `src/modules/integrations/**`, settings pages `app/settings/{notifications,webhooks,api-access}`, routes `app/api/{notifications,webhooks,oauth-clients,v1}`.
Tests: `tests/integrations-services.test.ts`, `tests/integrations-access.test.ts` (55 tests, no network, no database).

## What exists
- **Notifications** (`server/notifications.ts`): per-member, per-workspace flags (defaults when no row) and per-channel mutes limited to channels the member can reach; atomic update + audit; `shouldNotify()` for delivery code. Any active member may manage their own.
- **Webhooks** (`server/webhooks.ts`, `webhook-transport.ts`): owner/admin CRUD, secret shown once (AES envelope via `secret-crypto`), rotate, signed test ping, delivery history, redelivery (atomic claim, same delivery id), `emitWebhook()` (never throws, idempotent per `eventId`, payload cap, skips suspended workspaces), `deliverDueWebhooks()` (SKIP LOCKED claim + lease, Root retry schedule, settle only by claimant, retention purge). HMAC `X-MSP-Signature` = `sha256=` of `<timestamp>.<body>`; headers `X-MSP-Delivery` (stable id), `X-MSP-Timestamp`, `X-MSP-Event`.
- **SSRF**: https only, no credentials, ports 80/443, no internal names/private/reserved addresses, every DNS answer public, optional Root host allowlist, redirects never followed; checked at create and on every send. Uses `modules/media/net-guard` (read only).
- **REST keys** (`server/tokens.ts`): `msp_` keys, sha256 stored (legacy-compatible), shown once, expiry, optional channel limit, owner/admin only, live authority at use (demotion/disable/suspension/removal take effect), channel set = owner scope intersect key scope, per-key rate limit, bad-credential throttling per address, last-used throttle, revocation pauses webhooks the key subscribed.
- **REST v1** (`server/rest.ts`): `GET /api/v1/me`, `GET|POST /api/v1/webhooks`, `DELETE /api/v1/webhooks/[id]` (REST hooks; a key manages only its own).
- **OAuth connectors** (`server/oauth.ts`): dynamic registration (`POST /api/oauth-clients`, throttled, Root-bounded), consent page `/settings/api-access/connect`, `POST /api/oauth-clients/token` (PKCE S256, one-time hashed code deleted before verification, exact redirect match, authority re-read, key minted with expiry).
- **MCP** (`mcp.ts`): 12 tools exported (`integrationsToolDefinitions`, `integrationsTools`, `integrationsWriteTools`, `executeIntegrationsTool`). Key creation and OAuth consent are intentionally not MCP tools (they return bearer credentials into agent transcripts and let a credential mint another).
- **Root config** (`config.ts`): `INTEGRATIONS_CONFIG` tuple + `INTEGRATIONS_SWITCHES`. `integrations.api.v1MaxPageSize` is marked `planned` (no paged v1 list exists).

## Host wiring required (not done: files reserved to others)
1. `lib/config/registry.ts`: spread `INTEGRATIONS_CONFIG` (keys all `integrations.*`).
2. `server/mcp/server.ts`: add `integrationsToolDefinitions`; route names in `integrationsTools` to `executeIntegrationsTool({userId, workspaceId}, name, args)`; treat `integrationsWriteTools` as writes (key-based callers must satisfy the same service authorization; services re-check role).
3. Settings navigation (`lib/product.ts`/shell): entries for Notifications, Webhooks, API keys. Pages use `active` `settings/account` (notifications) and `settings/mcp` (others) as feature ids; add dedicated ids if a separate grant is wanted.
4. Worker: call `deliverDueWebhooks()` on a short schedule (single owner; it self-leases) and `purgeExpiredCodes()` hourly.
5. Emit points: call `emitWebhook(workspaceId, event, data, {eventId})` from publishing lifecycle (`post.scheduled|published|failed`), inbox sync (`comment.received`), connection lifecycle (`page.disconnected`), reports (`report.ready`). Not emitted today, so no real event reaches a receiver except pings.
6. Notification delivery: mail/in-app senders should call `shouldNotify()`; nothing sends alerts yet.
7. OAuth discovery (`/.well-known/oauth-authorization-server`, protected-resource metadata), `/oauth/authorize` entry redirecting to `/settings/api-access/connect`, and sign-in return-to preserving query parameters (current `requireViewer` redirect drops them). MCP bearer authentication does not yet accept `api_tokens`.
8. Proposed additive migration (not applied; no DDL was run):

```sql
ALTER TABLE api_tokens ADD COLUMN "expiresAt" TIMESTAMPTZ NULL, ADD COLUMN "targetIds" TEXT[] NULL;
-- optional but recommended: ensure webhook idempotency lookups stay cheap
CREATE INDEX IF NOT EXISTS webhook_deliveries_event_id_idx ON webhook_deliveries ("endpointId", (payload ->> 'eventId'));
```
Until `expiresAt` and `targetIds` exist the key list, creation, REST authentication and connector exchange report themselves unavailable (`tokenColumnsReady()` probes `information_schema`; only a positive answer is cached). Existing legacy `api_tokens` rows have `expiresAt` NULL and are rejected unless Root enables `integrations.api.allowNonExpiringLegacyKeys`.

## Limitations and unverified
- No real PostgreSQL, SMTP, browser, phone or theme verification; SQL checked against `prisma/schema.prisma` by reading only (tables `notification_settings`, `notification_mutes`, `api_tokens`, `webhook_endpoints`, `webhook_deliveries`, `"OAuthClient"`, `"OAuthCode"`, `root_activities`, `activity_logs`).
- DNS rebinding is not closed by the default sender (cannot pin the connection); use an egress proxy or an injected pinning sender.
- Webhook endpoints created by an API key require the key owner to still be an owner/admin.
- API key management has no HTTP route (server actions in `app/settings/api-access/actions.ts`); legacy `developerFeatures` workspace switch has no rebuild equivalent.
- No v1 posts/analytics endpoints (other modules own those); only identity and REST hooks.
- Redelivery and test pings send from the request thread (bounded by the Root timeout).
- Delivery signature replay protection is receiver side (timestamp header); no per-workspace emission rate limit.
