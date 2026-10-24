# Public API v1

Version: **v1** (current and only version). This document is the versioned
contract for the key-authenticated REST surface. Every endpoint below is
checked against source by `tests/api-v1-contract.test.ts`; a change to the
surface must update this document and that test together.

Status: source/unit evidence only (mocked host/service checks). No live
key/client run is recorded here.

## Authentication

- `Authorization: Bearer msp_...` on every request. Keys are the scoped
  workspace API keys issued in Settings, MCP API keys; this API issues none.
- Every request re-reads the key owner's current membership, role, plan,
  channel grants and the key's feature and resource ceilings. A key only
  narrows what its owner can do now: demotion, removal, expiry and revocation
  take effect immediately. Cookies are never read. Installation (Root) scope
  is never available here.
- Missing, revoked and expired keys are indistinguishable: `401`.
- The API as a whole can be switched off in Root
  (`integrations.api.enabled`); keys themselves are unchanged.

## Conventions

- Base path `/api/v1`. All responses use `Cache-Control: no-store`.
- Failures answer `{ "error": "<safe message>", "code": "<code>" }` with
  `invalid_request` 400, `unauthorized` 401, `forbidden` 403, `not_found`
  404, `unavailable`/`reconnect_required`/`conflict` 409,
  `upstream_failure` 502, and `rate_limited` 429 with a `retry-after`
  header in seconds.
- Rate limits are Root-managed (`integrations.api.ratePerMinute` per key,
  `integrations.api.failedAuthPerMinute` per caller address for rejected
  credentials).
- JSON bodies are capped by Root (`integrations.api.postsBodyMaxBytes`).
- Writes that change remote or shared state ask for the same exact
  confirmation strings as the app and MCP tools of the same name; repeat
  the returned confirmation with a stable request id after a lost response,
  inspect current state first, and never automatically resend an unknown
  outcome.

## Identity and channels

| Endpoint | Grant |
| --- | --- |
| `GET /api/v1/me` | none: workspace, role, granted features and channel scope of the key itself |
| `GET /api/v1/pages` | `settings/connections` read: channels inside the key ceiling |

## Posts and scheduling

Grant: `publishing/posts` (read for `GET`, write for `POST`). The key's
channel ceiling applies; a workspace that requires approval holds created
posts as `pending_approval`.

| Endpoint | Use |
| --- | --- |
| `GET /api/v1/posts` | Posts the key may see, newest first. Filters: `status` (comma list), `from`, `to`, `limit`, `q`, `channelId` (legacy `pages` accepts one id). Unknown keys are refused. |
| `POST /api/v1/posts` | Create a draft, or schedule with `scheduledAt` (ISO with offset). Body: `message`, `targetIds`, optional `firstComment`, `firstCommentDelayMinutes`, `link`, `media`, `destinationFormats`, `scheduleMode`, `destinationScheduleModes` (`application` or `remote`). Answers `201`. |
| `POST /api/v1/posts/[id]/schedule` | Schedule a draft. Body: `scheduledAt`, exact `SCHEDULE POST <id> <scheduledAt>` confirmation, optional schedule modes. |
| `POST /api/v1/posts/[id]/reschedule` | Move a scheduled post. Body: `scheduledAt`, exact `RESCHEDULE POST <id> <scheduledAt>` confirmation. |
| `POST /api/v1/posts/[id]/cancel-schedule` | Return a scheduled post to draft. Body: exact `CANCEL SCHEDULE <id>` confirmation. |
| `POST /api/v1/posts/[id]/queue` | Place the post at its next queue time through the shared queue service. |

There is no get-one, delete or idempotency-key route: a retried `POST`
after a lost response creates a second draft, so check `GET` first.
Update, publish-now, approvals and deletion stay on the app, session REST
and MCP.

## Analytics reads and reports

`GET /api/v1/analytics/[operation]` and `POST
/api/v1/analytics/[operation]` invoke the owning Analytics MCP operation
through the same host and product services: feature read/write grants,
channel ceilings, locks, confirmations and audit receipts are unchanged.
Writes accept POST only; reads accept GET (optional URL-encoded JSON
object in the single `input` query parameter) or POST (that object as the
JSON body). Unknown or repeated query parameters are refused.

| Operation | Method | Required feature |
| --- | --- | --- |
| `get_analytics_overview` | GET / POST | `analytics/overview` |
| `get_analytics_metric_details` | GET / POST | `analytics/overview` |
| `get_analytics_explorer` | GET / POST | `analytics/explorer` |
| `get_analytics_posts` | GET / POST | `analytics/posts` |
| `get_analytics_ad_objects` | GET / POST | `analytics/ads` |
| `get_analytics_demographics` | GET / POST | `analytics/demographics` |
| `compare_analytics` | GET / POST | `analytics/compare` |
| `get_analytics_pins` | GET / POST | `analytics/pins` |
| `pin_analytics_metric` | POST | `analytics/pins` |
| `unpin_analytics_metric` | POST | `analytics/pins` |
| `reorder_analytics_pins` | POST | `analytics/pins` |
| `get_analytics_goals` | GET / POST | `analytics/goals` |
| `set_analytics_goals` | POST | `analytics/goals` |
| `export_analytics_report` | GET / POST | `analytics/reports` |
| `list_report_templates` | GET / POST | `analytics/reports` |
| `manage_report_template` | POST | `analytics/reports` |
| `list_report_schedules` | GET / POST | `analytics/reports` |
| `manage_report_schedule` | POST | `analytics/reports` |
| `list_report_runs` | GET / POST | `analytics/reports` |
| `generate_report` | POST | `analytics/reports` |
| `list_metric_alerts` | GET / POST | `analytics/reports` |
| `manage_metric_alert` | POST | `analytics/reports` |

## Ads reporting and management

`GET /api/v1/ads/[operation]` and `POST /api/v1/ads/[operation]` work
like the Analytics family above, through the owning Ads MCP operations.
Spend-changing operations keep their preview/apply flow: repeat the
returned exact confirmation with the same reviewed operation and a stable
`requestId` at `apply_ads_change`.

| Operation | Method | Required feature |
| --- | --- | --- |
| `get_ads_report_rows` | GET / POST | `ads/campaigns` |
| `export_ads_report` | GET / POST | `ads/campaigns` |
| `list_ad_accounts` | GET / POST | `ads/campaigns` |
| `get_ad_creation_options` | GET / POST | `ads/campaigns` |
| `get_ads_performance` | GET / POST | `ads/campaigns` |
| `get_live_ad_status` | GET / POST | `ads/campaigns` |
| `create_ad_campaign` | POST | `ads/campaigns` |
| `create_ad_set` | POST | `ads/campaigns` |
| `update_ad` | POST | `ads/campaigns` |
| `compare_ads_performance` | GET / POST | `ads/compare` |
| `list_ads_objects` | GET / POST | `ads/objects` |
| `get_ads_object` | GET / POST | `ads/objects` |
| `get_ads_management_options` | GET / POST | `ads/campaigns` |
| `get_ads_creative_image` | GET / POST | `ads/campaigns` |
| `list_ads_creative_sources` | GET / POST | `ads/campaigns` |
| `preview_ads_change` | GET / POST | `ads/campaigns` |
| `apply_ads_change` | POST | `ads/campaigns` |
| `list_ads_changes` | GET / POST | `ads/campaigns` |
| `resolve_ads_change` | POST | `ads/campaigns` |
| `list_ads_creatives` | GET / POST | `ads/campaigns` |

## Outbound webhook subscriptions

Grant: `settings/webhooks` (write for changes). A key sees and removes
only the subscriptions it created; a key restricted to selected channels
is refused because events are workspace-wide.

| Endpoint | Use |
| --- | --- |
| `GET /api/v1/webhooks` | List this key's subscriptions. |
| `POST /api/v1/webhooks` | Subscribe a public `https` URL to at least one event. Answers `201`; the signing secret is returned once, here only. |
| `DELETE /api/v1/webhooks/[id]` | Remove one of this key's subscriptions. |

Event catalog, signing and delivery semantics are owned by
[INTEGRATIONS.md](INTEGRATIONS.md).

## Versioning policy

- `v1` is stable: no breaking change (removed endpoint, removed field,
  changed meaning, new required input, stricter auth) ships under `/api/v1`.
- Additive changes (new endpoint, new optional input, new response field)
  may ship under `v1` and are recorded below.
- A breaking change ships as `/api/v2` beside a supported `/api/v1`, with
  a dated migration note here.

## Changelog

- **v1.0 — 2026-10-23:** first versioned reference. Documents the existing
  surface with no route change, including the metric-alert operations that
  were missing from the earlier integration notes.
