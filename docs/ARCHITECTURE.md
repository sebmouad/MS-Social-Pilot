# Architecture

> **Legacy application document.** Active rebuild work follows [../AGENTS.md](../AGENTS.md), [../rebuild/docs/ARCHITECTURE_CONTRACT.md](../rebuild/docs/ARCHITECTURE_CONTRACT.md), and [../rebuild/docs/ARCHITECTURE.md](../rebuild/docs/ARCHITECTURE.md). Legacy styling, routes, settings paths and deploy instructions do not define the replacement.

## Processes

Two processes share one PostgreSQL database:

- **Web**: Next.js 15 App Router (`scripts/start.mjs` in production). Server
  components read the database directly; route handlers under `src/app/api`
  do every write.
- **Worker**: `scripts/worker.ts`, a long-lived loop (`src/lib/scheduler/loop.ts`)
  that runs the job table in `src/lib/scheduler/jobs.ts`. Nothing publishes
  without it. `POST /api/cron/tick` (with `CRON_SECRET`) can drive the same
  jobs from an external scheduler instead.

## Routes

| Folder | Role |
|---|---|
| `src/app/(app)/` | Signed-in screens. The layout wraps them in `AppShell` and `ConfirmProvider` and refuses screens whose module is off. Pages call `requirePage`. |
| `src/app/(root)/root/` | Root section with `RootShell`; every page calls `requireRoot`, which answers 404 to anyone but root. |
| `src/app/(auth)/` | Sign-in, two-step, registration, password reset, email check. |
| `src/app/api/` | Route handlers wrapped in `route()` from `src/lib/api.ts`, which turns `AppError`, zod and auth errors into JSON. Signed-in routes call `requireAuth` (or `requireCapability`); root routes call `requireRootApi`. |
| `src/app/api/v1/`, `src/app/api/mcp/` | Public REST API and MCP server, authenticated by API keys (`src/lib/api-tokens.ts`, operations in `src/lib/public-api.ts`). |
| `src/middleware.ts` | Refuses cross-site API writes and passes the request path to server code, so modules switched off are refused in one place. |

Every page sets its title with `screenMetadata` (checked by `tests/metadata.test.ts`).

## Data model

`rebuild/prisma/legacy-schema.prisma` holds about 90 models; migrations in `rebuild/prisma/migrations`
are additive so the previous release runs on the new schema. Main groups:

- **Identity and tenancy**: `User` (with `isInstanceOwner` for root), `Session`,
  `Passkey`, `TrustedDevice`, `RecoveryCode`, `Workspace`, `Membership`,
  `MemberPageAccess`, `Invitation`, `ClientInvitation`, `Plan`.
- **Connections**: `SocialAccount` (a Facebook profile or another network's
  account, token encrypted), `Target` (a Page, Instagram account or other
  channel; `TargetType`), `InstagramAccount`, `AdAccount`, `PageGroup`.
- **Content**: `Post` (one piece of content), `PostTarget` (its delivery to one
  channel, with status, remote id and insights), `PostVersion`, `PostNote`,
  `Media`, `QueueSlot`, `Label`, `PostTemplate`, `Snippet`, `CaptionTest`,
  `FeedSource`, `ContentMixRule`, `KeyDate`, `SeasonalMode`, `Task`.
- **Engagement**: `PostComment`, `PageReview`, `Conversation`,
  `ConversationMessage`, `ExternalPost`, `PageVideo`, `InboxNote`,
  `ModerationRule`, `SavedReply`.
- **Analytics**: `PageInsight`, `MetricAvailability`, `InstagramInsight`,
  `AdInsight`, `PageGoal`, `ChartNote`, `ShortLink`, `LinkClick`,
  `ReportTemplate`, `ReportSchedule`.
- **Sharing and integrations**: `ShareLink`, `ReviewDecision`, `ApiToken`,
  `OAuthClient`, `WebhookEndpoint`, `WebhookDelivery`, `ChatChannel`,
  `CalendarFeed`, `BioPage`.
- **Operations**: `AppSetting` (runtime settings), `WorkerHeartbeat`,
  `WorkerJobRun`, `GraphUsage`, `ActivityLog`, `RootActivity`, `ErrorEvent`,
  `SystemAlert`, `BackupRun`, `UptimeDay`, `AiGeneration`, `AiVideo`.

## Settings

Configuration lives in the database, not in `.env`. The registry
`src/lib/settings/definitions.ts` defines every setting (type, default, secret,
environment fallback); root edits them under Root › Settings and Root ›
Platforms. Server code reads them with `setting`, `settingString`,
`settingNumber` and `settingBoolean` from `src/lib/settings/index.ts`. Only
`DATABASE_URL`, `ENCRYPTION_KEY`, `SESSION_SECRET` and process options stay in
`.env`. The full list is in [OPERATIONS.md](OPERATIONS.md).

## Publishing

`createPost` in `src/lib/posts.ts` validates against the network rules, the
member's Pages and the plan, and writes a `Post` with one `PostTarget` per
channel. A post is published now, at a time, in the next queue slot, or
handed to Facebook as a natively scheduled post.

The worker's publish job (`src/lib/scheduler/runner.ts`) claims due deliveries
with `findDue` (skipping suspended workspaces), publishes them and retries with
backoff (`backoff.ts`). Facebook goes through `src/lib/facebook/publish.ts`
(feed, photos, video, Reel, Story; first comment afterwards); Instagram through
`instagram-publish.ts` (containers, then publish); every other network through
`publishToNetwork` in `src/lib/networks/index.ts`.

## Connectors

`src/lib/networks/types.ts` is the contract every non-Meta connector follows:
connect (OAuth or app password, `src/lib/networks/connect.ts`), publish, an
optional `stats` for analytics, and failure kinds (auth, rate limit, refused)
that decide retries. One file per network: Bluesky, Mastodon, LinkedIn,
Threads, X, Pinterest, YouTube, TikTok, Telegram. Shared HTTP helpers use
`netJson`. Limits per network are in `src/lib/network-rules.ts`, a plain module
that the composer (warnings) and the server (refusal) both read.

Facebook and Instagram use the Graph client in `src/lib/facebook/graph.ts`
(`graphRequest`, `graphPaged`, appsecret proof on every call) with a usage
budget from Meta's headers (`budget.ts`) that background jobs respect. OAuth
(`oauth.ts`, `exchangeForLongLivedToken`) and requested scopes
(`permissions.ts`) are there too. See [META_API_NOTES.md](META_API_NOTES.md).

## Selection model

One channel selection drives every list, calendar, inbox, analytics view,
report and export. The address carries it (`group`, `pages`, `net`;
`src/lib/selection.ts`), and `rememberSelection` keeps the last one in a cookie
per workspace so it survives navigation. The server reads it with
`loadPageFilter` or `loadSelection` (`src/lib/page-filter.ts`), always clamped
to the member's Page access: parameters can only remove Pages, never add them.
Queries then use `targetScope` and `postScope`, and writes check
`assertPagesAllowed` and `assertPostInScope` (`src/lib/page-access.ts`).
Figures across several channels add up by the rules in `src/lib/aggregate.ts`.

## Auth, roles and root

- Sessions are database rows behind a signed cookie (`src/lib/auth.ts`,
  `src/lib/sessions.ts`); two-step sign-in with TOTP, passkeys and recovery
  codes (`src/lib/two-step.ts`, `src/lib/passkeys.ts`).
- `registerUser` makes the first account ever created root
  (`isInstanceOwner`), under an advisory lock. `canManageInstance` is the check.
- Workspace roles and capabilities are one table in `src/lib/constants.ts`
  (`canManageAccounts`, `canCompose` and the rest read it); viewer and client
  limits are in `src/lib/role-access.ts` (`mayWrite`, `mayOpenScreen`).
- Modules (analytics, ads, schedule) are switched per workspace and per member
  (`enabledModules`, `moduleOfPath` in `src/lib/modules.ts`); developer
  features are gated by `mayUseDeveloperFeatures`.
- Root can open any workspace as its owner (logged); root actions go to
  `RootActivity`, workspace actions to `ActivityLog` via `logActivity`.
- Each workspace is isolated: every query filters on the workspace and the
  member's Page scope; `tests/tenant-isolation.integration.test.ts` checks it.

Details and the full matrix: [PERMISSIONS.md](PERMISSIONS.md).

## Analytics

The worker reads Page and post insights, edges and other networks' counters
into the database (`src/lib/analytics.ts`, `src/lib/facebook/insights.ts`,
`src/lib/network-analytics.ts`); screens read only stored figures. The metric
catalogue is `src/lib/facebook/metrics.ts`. The per-Page analysis model is in
`src/lib/page-analysis.ts`, the Summary in `src/lib/analytics-summary.ts`.

## Time, text and AI

Times are stored in UTC and shown with `formatInZone` in the workspace time
zone; form input is converted with `localInputToUtc` (`src/lib/time.ts`). All
text is in `messages/en.json` and `messages/fr.json`. AI goes through
`src/lib/ai.ts` and `src/lib/ai-providers.ts` (Anthropic, OpenAI, Gemini), with
model lists fetched from each provider (`src/lib/ai-models.ts`), costs and a
monthly budget (`src/lib/ai-prices.ts`).
