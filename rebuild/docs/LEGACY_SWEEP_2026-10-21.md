# Legacy sweep, 2026-10-21

Lane: exhaustive legacy sweep (report only; no source changed). Compared against local HEAD `8d9ccbe7`.
**Evidence kind for every row: static source search (grep/ls) of the checked-in tree.** Nothing here was run in a browser, against PostgreSQL, a provider or production. "done" means a rebuild route/service/Root key exists in source, not that it was proven live (see LEGACY_CAPABILITY_PARITY.md for proof levels). Status vocabulary: done / partial / missing / obsolete (with reason).

Inventory sizes: 95 legacy pages, 191 legacy `route.ts`, ~150 `src/lib` files, 94 Prisma models (+`RebuildReportRun`), 101 Root settings keys, 8 env vars in `.env.example`.

## 0. Reconciliation at HEAD `25c3ea53` (2026-10-22)

Lane: legacy sweep reconcile (docs only). Evidence kind: **static source search (grep/ls/git log) of the checked-in tree at `25c3ea53`; no test, browser, PostgreSQL, provider or production run.** Sections 1 to 8 below keep their original wording and dated `8d9ccbe7` status; this section supersedes any row it names. Where a row says "installed" or "done at source", the proof level is the one in LEGACY_CAPABILITY_PARITY.md (mocked/unit only).

### 0.1 Rows closed or changed since `8d9ccbe7`

| Row | Was | Now | Evidence |
| --- | --- | --- | --- |
| Gap 1: Meta deauthorize + data-deletion callbacks | missing | **done at source.** Owner must repoint the Meta dashboard URLs to `/api/platforms/facebook/deauthorize` and `/data-deletion` | `src/app/api/platforms/[platform]/{deauthorize,data-deletion}/route.ts`, `src/platforms/facebook/data-callbacks.ts`, `tests/facebook-data-callbacks.test.ts`; LEGACY_SWEEP_STATUS_Q13.md |
| Page `data-deletion` | missing | **done at source** (public status page, EN/FR, local constant copy, not Root-managed) | `src/app/data-deletion/page.tsx` |
| Gap 8 / Instagram (P0) | helpers only | **installed, disabled by default (`platforms.instagram.enabled` false)**: adapter, connection, inbox host, analytics host, analytics job, container journal/recovery, publishing (image/carousel/Reel), first comment. Not declared: media deletion, native scheduling, Stories, DMs, ads. Fixture/mocked evidence only; no live Graph run | `src/platforms/index.ts` (`PLATFORM_MODULES = [facebook, instagram]`), `src/platforms/instagram/{host,connection,publishing,inbox-host,analytics-host,jobs}.ts`, `src/server/platforms/index.ts:11`, tests `instagram-{host-connection,hosts,jobs,container-journal,container-recovery,customer-filters-ui,selection}.test.ts` |
| Gap 7 / AI agents; page `settings/agents`; routes `api/ai-agents*`; `lib/ai-agents`; model `AiAgent` | missing | **Done.** Writing agents module plus scheduled runs: hourly `scheduledAgents` worker writes each due agent’s drafts as its creator (metered, audited, never scheduling/publishing); CRUD + run-now with exact confirmations, /agents scheduled section, REST `/api/agents/scheduled`, MCP `list_scheduled_agents` + `manage_scheduled_agent` | `src/modules/agents/**`, `src/app/agents/page.tsx`, `src/app/api/agents/route.ts`, `src/app/api/agents/scheduled/route.ts`, `docs/MCP_PARITY.md`, migration `20261101100000_rebuild_writing_agents`, tests `agents-*.test.ts` + `scheduled-agents.test.ts` |
| Posts CSV (sync only) | partial | **done at source** for background export: queued job, status, private download, expiry, retries, worker job `postExports`, MCP `posts_export_job`/`posts_export_status`. Sync `export_posts` remains. Migration `20261101100100_rebuild_post_exports` authored, application not observed | `src/modules/publishing/server/export/{jobs,http,config}.ts`, `src/app/api/publishing/posts/export/jobs/route.ts`, `docs/MCP_PARITY.md:157-158`, `tests/async-post-export.test.ts` |
| AI monthly budget and prices (`ai.monthlyBudgetUsd`, `ai.priceOverrides`) | partial | done at source (already noted in section 6) | `src/modules/ai/server/usage.ts` |
| Facebook Groups publishing/discovery | missing | **obsolete by owner decision 2026-10-22**: Meta removed the Groups API (2024-04-22); rows `features.groups` and Group publishing are not to be rebuilt | commit `8aefd7d8` |
| Gap 3, 2 (rest), 4, 5, 6, 9, 10 | open | **still open** (re-verified below) | see 0.2 |

### 0.2 Re-verified still missing or partial at `25c3ea53`

| Row | Status | Evidence of absence / state |
| --- | --- | --- |
| `/api/health` and a readiness probe (gap 6) | missing | no `health` route under `src/app/api`; no match for `api/health` in `rebuild/src` |
| `error_events` / `system_alerts` writers, `/api/errors` client reporter, `ErrorReporter`, alert test (gap 3) | missing | only `src/server/root/legacy/backups.ts` and `src/modules/root/server/errors.ts` reference the tables (readers) |
| `/privacy-policy`, `/terms`, `/help`, `/pricing`, `/changelog`, `/status`, `operator.*`, `site.public` (gap 2 rest) | missing | `src/app` has only `data-deletion` among the legacy public pages |
| Root changelog (`root/changelog`, `api/root/changelog*`, `ChangelogEntry`), Root client invitations, Root alerts test, `root/meta/usage` (`graph_usage`) | missing | `src/app/api/root` has no `changelog`, `client-invitations`, `alerts`; no table reference to `changelog_entries`, `client_invitations`, `graph_usage` |
| Caption tests, chat channels (Slack/Telegram), spam check, engagement outlook, link preview, structured data, translated posts, AI image/video/voice, `api_tokens` | missing | no reference to `caption_tests`, `chart_notes`, `key_dates`, `seasonal_modes`, `public_holidays`, `calendar_feeds`, `chat_channels`, `ai_videos`, `api_tokens` in `rebuild/src` except the data-control README keep-list; no route for them in `src/app/api` |
| Nine other network connectors | missing | `PLATFORM_MODULES` lists Facebook and Instagram only |
| Host backup scripts, root `prisma/migrations`, `prod-deploy.sh` dependencies (gaps 4, 5) | open | `rebuild/scripts` has no `server/` directory; root `scripts/server/*` unchanged |
| Legacy config import beyond Facebook/AI/auth/app URL (gap 9), OAuth client re-registration (gap 10) | open | `rebuild/scripts/import-legacy-config.ts` unchanged scope |

### 0.3 Legacy capabilities not listed in sections 1 to 8 (added by this reconcile)

Source: `src/lib/scheduler/jobs.ts`, `src/middleware.ts`, `src/components/*`, `src/lib/*`, `public/`, `src/app/manifest.ts`.

| New row | Legacy source | Rebuild state | Status |
| --- | --- | --- | --- |
| Retention pruning job (`housekeeping`: activity, email, click, AI history, errors) | `scheduler/jobs.ts` `housekeeping`, `lib/housekeeping.ts`, `settings retention.*` | Done: nightly `retention` job (`settings/server/retention.ts`, `retention.schedule`) prunes activity/email/click-detail/AI/error/worker-run/report-run history; feeds, insight snapshots, link totals, running reports untouched. `retention.auditDays`/`syncLogDays`/`analyticsDays` now `active` + new `emailDays`/`clickDays`/`aiDays`/`errorDays`/`schedule`/`batchWorkspaces`. UI Settings › Data, REST `GET/POST /api/settings/data/retention`, MCP `get_retention_status`/`prune_old_records` | done (`tests/retention.test.ts`, parity-guard + config-validation green; dead-letter media stays with media-cleanup) |
| Share-link "publish anyway" auto-approval (`clientDeadlines` job, `approveUnanswered`, `publishAnywayHours`) | `lib/share-links.ts:102`, `scheduler/jobs.ts` | Done: `sharingDeadlines` worker (`sharing/server/deadlines.ts`, every 5 min) approves unanswered pending posts inside each live deciding link’s window via the review lifecycle as the creator; revoked/expired/rotated links and departed creators skipped. `publishAnywayHours` on create/update (decides-only, Root-capped, rotates secret), LinksManager field + badge, existing REST/MCP extended | done (`tests/sharing-deadlines.test.ts`; new keys `sharing.publishAnywayMaxHours`/`deadlineSchedule`/`deadlineBatchLinks`) |
| Scheduled AI agent runs (`aiAgents` job, `runDueAgents`) | `lib/ai-agents.ts` | Done: `scheduledAgents` worker (`agents/server/scheduled.ts`, hourly) claims due agents (workspace-timezone weekday + `lastRunOn`), writes drafts as the creator with hourly AI metering, never scheduling/publishing; AI failure frees the day. CRUD + run-now with exact confirmations, /agents section, REST `/api/agents/scheduled`, MCP `list_scheduled_agents`/`manage_scheduled_agent` | done (`tests/scheduled-agents.test.ts`; new keys `agents.scheduledRuns*`; provider evidence with AI lane) |
| AI video polling (`aiVideos`), AI voice, AI image | `lib/ai-video.ts`, `ai-voice.ts`, `ai-image.ts`, `components/AiVideoPanel.tsx`, `AiVoicePanel.tsx` | none (already in section 3, repeated here for the job) | missing |
| Caption-test evaluation job (`captionTests`) | `lib/caption-test.ts` | none | missing |
| Holiday and trend refresh jobs (`holidays`, `trends`), `TrendKeywords` | `lib/holidays.ts`, `lib/trends.ts` | `calendarHolidays` / `calendarTrends` worker jobs (`scripts/worker.ts`, `modules/calendar-extras/server/refresh.ts`), Root `calendarExtras.refresh` + two schedule keys; keywords via `change_calendar_trends` | **done at source** (mocked fetch/DB tests `tests/calendar-extras-refresh.test.ts`; no live Nager/Google fetch, no PostgreSQL run) |
| Alert evaluation job (`alerts`: publish failures, disk, uptime) and uptime days | `lib/system-alerts.ts`, `lib/uptime.ts` | no writer; Telegram/disk alerts absent (section 6) | missing |
| Negative-comment spike watcher (`negativeComments`) | `lib/negative-comments.ts`, `negativeSpikeEmail` | `negativeSpike` notification event + sentiment input | done at source (`modules/inbox/server/notification-events.ts`, `settings/notifications/server.ts`) |
| Inbox digest, queue-empty and token-expiry notifications | `email/notify.ts` | notification catalog, `connection-alerts.ts`, queue-empty in `settings/notifications/server.ts` | done at source (mail delivery unproven) |
| Automatic best-time application (`bestTimes` job, `applyBestTimes`) | `lib/best-times.ts` | Done: weekly `bestTimes` worker (`publishing/server/best-time-apply.ts`) adds strongest new evidence-backed times to channel queues for `apply`-mode workspaces (claims the week, per-channel room caps, skips covered times, audits each add). Settings workspace card with status + apply-now, REST `GET/POST /api/publishing/best-times/apply`, MCP `get_best_time_apply_status`/`apply_best_times` | done (`tests/best-time-apply.test.ts`; new keys `publishing.bestTimeApplySchedule`/`AddPerWeek`/`MaxOwnSlots`/`ApplyBatchWorkspaces`) |
| Global command palette | `components/CommandPalette.tsx` | Done: Ctrl/⌘-K palette in the shell topbar (`components/CommandPalette.tsx`) listing permission-filtered pages in sidebar order with sidebar titles; same service backs REST `GET /api/home/commands` and MCP `list_navigation_commands`. Keyboard: arrows/Enter/Escape; chrome in EN/FR | done (`tests/command-palette.test.ts`, `tests/command-palette-ui.test.ts`; new keys `home.commandPaletteLimit`/`home.commandPaletteCopy`) |
| Installable web app: `manifest.ts`, `public/sw.js`, `offline.html`, icons, `ServiceWorker.tsx` | `src/app/manifest.ts`, `public/*` | no `rebuild/public`, no manifest or service worker in `rebuild/src` | missing |
| Central cross-site write refusal (`Sec-Fetch-Site`) | `src/middleware.ts`, `lib/cross-site.ts` | no `src/middleware.ts`; module HTTP helpers carry same-origin checks (`modules/*/http.ts`, `server/root/legacy/http.ts`). Smoke waiver "sign-out Origin acceptance" is open | partial |
| Module/feature path gating in middleware (`PATHNAME_HEADER`, `lib/product-catalog.ts`) | `middleware.ts`, `lib/modules.ts` | replaced by manifest, entitlement and permission feature switches (`server/permissions/index.ts`) | done (different mechanism) |
| Likes versus followers identity for audience growth (`audienceGrowthIdentity`) | `lib/audience-growth-metrics.ts` | Facebook-owned metric labels and goals; audience trend identity is an open adapter gap (AGENT_HANDOFF numbers) | partial |
| @mentions in internal notes | `lib/mentions.ts` | Done: Inbox private notes accept `@name` mentions of teammates who can see the channel (`inbox/server/productivity.ts`), stored on `inbox_notes."mentionIds"` (migration `20261102120000_rebuild_inbox_note_mentions`), notified via new `inbox_note_mention` event (in-app + email honoring `onNoteMention`). @ autocomplete + highlighted names in the thread panel (EN/FR); existing REST/MCP extended | done (`tests/inbox-mentions.test.ts`, `tests/inbox-mention-ui.test.ts`; new keys `inbox.mentionMaxCount`/`mentionSuggestionLimit`/`mentionNotificationsEnabled`) |
| Host install and bootstrap: `scripts/install-debian.sh`, `setup.mjs`, `start.mjs`, `scripts/admin/set-root.ts`, `reset-two-step.ts` | root `scripts/` | rebuild has `prod-owner-reset-link.sh`, Root user reset-two-step API; no installer or set-root port (already in section 8 for `set-root`) | partial |
| Short link path `/l/[slug]` | `src/app/l/[slug]` | `src/app/s/[slug]`; already in section 3 (printed links break) | done (path changed) |
| Facebook `opengraph` link preview in composer | `lib/facebook/opengraph.ts`, `api/link-preview` | none | missing |

Totals for this reconcile: 7 rows closed, advanced or retired at source (0.1), 19 rows in 0.3 (10 missing, 5 partial, 4 done; two of them, AI video/voice/image and `/l/` to `/s/`, repeat section 3 to record the job or path side). Rows whose live proof is unobserved stay unproven.

## 1. Headline gaps (action items)

| # | Gap | Why it matters | Suggested owner |
| --- | --- | --- | --- |
| 1 | **No Meta data-deletion callback and no deauthorize callback** (`/api/facebook/data-deletion`, `/api/facebook/deauthorize` have no rebuild route; nothing under `rebuild/src` mentions them). | Meta platform policy requires them; the Meta app dashboard still points at the legacy URLs on `social.newsgeet.com`, which now 404. | Facebook platform owner (route belongs to `src/platforms/facebook/`, signed-request parsing + shared deletion service) |
| 2 | **No public legal/info pages**: `/privacy-policy`, `/terms`, `/data-deletion`, `/help`, `/pricing`, `/changelog`, `/status`. Legacy `operator.*` and `site.public` settings have no rebuild key. | Meta app review needs a privacy URL; the data-deletion instruction page is the status URL in gap 1. | App owner + Root config |
| 3 | **Nothing writes `error_events` or `system_alerts`.** Rebuild `src/instrumentation.ts` only starts public-origin refresh; legacy `onRequestError` -> `recordError` and `/api/errors` are gone. Root Errors/Backups pages only read legacy rows. | Root error console and alert list silently go stale. | Root owner |
| 4 | **Host backup scripts live only in the legacy tree** (`scripts/server/offsite-backup.sh`, `restore-test.sh`, `install-offsite.sh`, `hardening-20261009.sh`); they insert `backup_runs` rows that Root Backups reads. Installed to `/usr/local/sbin/ms-social-pilot-*` + `/etc/cron.d/ms-social-pilot-offsite`. | Deleting the root tree would orphan the source of the backup/restore-test record. | Release owner: move into `rebuild/scripts/server/` before cleanup |
| 5 | **Root `prisma/migrations/` is the only migration history** (134 dirs, rebuild ones included) and `prod-deploy.sh` runs `npm ci` at the repo root and tars `prisma/migrations`. `rebuild/package.json` uses `../node_modules/.bin/vitest` and `../.env`. | The "legacy" root cannot simply be deleted. | Release owner |
| 6 | No `/api/health`. `prod-deploy.sh` probes `/sign-in`; `prod-rollback-drill.sh` probes legacy `/api/health`. | No cheap unauthenticated readiness probe; drill breaks once legacy is removed. | App owner |
| 7 | Missing customer features: workspace **Activity/Email history** (`settings/history`), **AI agents** (`settings/agents`), **caption tests**, **chart notes**, **key dates / seasons / holidays / trends**, **ICS calendar feeds**, **Slack/Telegram alert channels** (`chat_channels`), **spam check**, **engagement outlook**, **composer link-preview fetch**, **translated posts**, **AI image/video/voice**, **legacy REST `api_tokens`**. | Legacy capabilities not in LEGACY_CAPABILITY_PARITY.md (it has no rows for them). | Per module |
| 8 | Nine non-Facebook connectors (Bluesky, Mastodon, LinkedIn, Threads, X, Pinterest, Telegram, YouTube, TikTok) and Instagram publishing. | Partial: q-31 adds staged Mastodon/Threads/X adapters and registered Root settings; shared connection hosts, customer installation and end-to-end parity remain open. Evidence: 28 synthetic provider fixtures and 43 registration/config/parity checks pass; TypeScript zero errors. See provider READMEs and MCP_PARITY q-31. Other networks require their own evidence. | Platform owners |
| 9 | `import-legacy-config.ts` imports only Facebook, AI-provider, auth-policy and APP_URL values. Operator, alerts, retention, scheduler, media and link-shortener legacy settings are not imported. | Silent config loss if the legacy `app_settings` table is later dropped. | Root owner |
| 10 | Legacy `oauth_clients`/`oauth_codes` are not read; rebuild uses new `mcp_oauth_clients`/`mcp_oauth_codes`. Existing connector registrations must be re-created. | Connectors authorised under legacy stop working. | Integrations owner (document or migrate) |

**Update 2026-10-22 (history/public/errors lane; source + mocked tests only, no browser, PostgreSQL or production run):** gap 2 (public pages), gap 6 (`/api/health`) and the Settings › History and Root › Changelog parts of gap 7 are implemented in `src/modules/history/`; gap 3 is closed for server, browser and error-boundary errors via `src/server/errors/`. Still open from gap 3: worker-side `recordError` calls, `system_alerts`/`uptime_days` writers and alert delivery. The legacy `changelog_entries`, `activity_logs`, `email_logs` and `error_events` tables are the same tables the rebuild reads and writes, so no data import script is needed.

## 2. Pages (`src/app/**/page.tsx`)

Rebuild paths are relative to `rebuild/src/app/`.

| Legacy page | Rebuild equivalent | Status |
| --- | --- | --- |
| `(app)/accounts` | `settings/connections` | done |
| `(app)/ads` | `ads`, `ads/campaigns`, `ads/compare`, `ads/objects` | done (live management unproven) |
| `(app)/agency` | `agency`, `agency/clients` | done |
| `(app)/analytics` | `analytics` | done |
| `(app)/analytics/campaigns` | `analytics/reports` (Destinations/link details) | partial: no UTM-campaign page |
| `(app)/analytics/links` | `reports` link details; click tracking `s/[slug]` | partial: no dedicated page |
| `(app)/analytics/post/[postTargetId]` | `analytics/posts`, `analytics/explorer` | done |
| `(app)/analytics/tests` | `app/analytics/tests/page.tsx` → `modules/caption-tests/ui/CaptionTestsPage.tsx` | done (2026-10-22: results, winner, start form, learn; `tests/caption-tests-service.test.ts`, `tests/ai-content-tools-ui.test.ts`; browser/live provider unverified) |
| `(app)/approvals` | `publishing/approvals` | done |
| `(app)/calendar` | `publishing/calendar` | done |
| `(app)/calendar/dates` | `publishing/calendar/dates` | done at source (route + service/UI tests; board marks on the calendar) |
| `(app)/calendar/trends` | `publishing/calendar/trends` (+ `/seasons`, `/feeds`) | done at source (stored data; refresh jobs above) |
| `(app)/compose`, `compose/import` | `publishing/compose` + `api/publishing/posts/import` | done |
| `(app)/connections` | `settings/connections` | done |
| `(app)/dashboard` | `home` | done |
| `(app)/design` | none | obsolete: internal style guide; replaced by rebuild design system docs |
| `(app)/e2e-slow`, `e2e-throw` | `error.tsx`, `global-error.tsx`, `loading.tsx` | obsolete: legacy e2e fixtures |
| `(app)/feeds` | `publishing/feeds` | done |
| `(app)/inbox`, `comments`, `messages`, `reviews` | `inbox` | done |
| `(app)/inbox/replies` | `inbox` productivity (`api/inbox/productivity`) | done |
| `(app)/inbox/response-time` | `analytics/reports` response reports | done |
| `(app)/inbox/rules` | `inbox/moderation` | done |
| `(app)/oauth/authorize` | `oauth/authorize` | done |
| `(app)/posts` | `publishing/posts` | done |
| `(app)/queue`, `queue/mix` | `publishing/queue` + `api/publishing/content-mix` | done |
| `(app)/reports` | `reports`, `analytics/reports` | done |
| `(app)/settings` | `settings/workspace` | done |
| `(app)/settings/account` | `settings/account` | done |
| `(app)/settings/agents` | none | missing (AI agents) |
| `(app)/settings/api` | `settings/mcp` (+ person keys, v1 routes) | partial: legacy `api_tokens` not honoured |
| `(app)/settings/bio` | `settings/bio` | done |
| `(app)/settings/export` | `settings/data` | partial (owner ZIP partial per parity file) |
| `(app)/settings/fields` | `publishing/collaboration` FieldsManager | done |
| `(app)/settings/history` | `settings/history` | done (source + mocked service/route/MCP tests, 2026-10-22): `src/modules/history/ui/HistoryScreen.tsx`, `server/history.ts`, `GET /api/settings/history/{activity,email}`, MCP `list_workspace_activity`/`list_workspace_email_log`; owner/admin only |
| `(app)/settings/media` | `publishing/media` | done |
| `(app)/settings/notifications` | `settings/notifications` | done |
| `(app)/settings/pages` | `settings/connections`, `settings/profiles` | done |
| `(app)/settings/permissions` | `settings/team` | obsolete: merged by contract section 6 |
| `(app)/settings/sharing` | `settings/sharing` | done |
| `(app)/settings/team` | `settings/team` | done |
| `(app)/settings/webhooks` | `settings/webhooks` | done |
| `(app)/tasks` | `tasks` | done |
| `(app)/templates` | `publishing/templates` | done |
| `(app)/welcome` | `home` onboarding + invitations (ONBOARDING.md) | partial |
| `(auth)/login` | `sign-in` | done |
| `(auth)/login/two-step`, `two-step/setup` | `two-step`, `two-step/enroll` | done |
| `(auth)/register` | `sign-up` | done |
| `(auth)/forgot-password`, `reset-password` | `password-recovery` | done |
| `(auth)/verify-email` | `verify-email` | done |
| `(root)/root` | `root` | done |
| `root/activity` | `root/activity` | done |
| `root/agency` | `agency` module + `root/workspaces` | partial: client invitations (`client_invitations`) unread |
| `root/alerts` | `root/operations` / `root/modules` diagnostics | partial: no `system_alerts` writer, no alert test button |
| `root/backups` | `root/backups` | partial: read-only; writers are legacy host scripts |
| `root/changelog` | `root/changelog` | done (source + mocked tests): `src/app/root/changelog/page.tsx`, `ui/ChangelogManager.tsx`, `server/changelog.ts`, `/api/root/changelog*`, Root MCP `list/add/remove_root_changelog_*` |
| `root/config`, `config/[section]` | `root/config`, `root/modules/[id]`, `root/platforms/[id]` | done |
| `root/connections` | `root/connections` | done |
| `root/danger` | `root/lifecycle` | done |
| `root/errors` | `root/errors`, `root/errors/[id]` | done for the recorder (2026-10-22): `src/server/errors/recorder.ts` (instrumentation `onRequestError`, browser reports, error boundary) now writes `error_events`; worker-side `recordError` calls and `system_alerts` writers remain open |
| `root/meta`, `meta/connections` | `root/platforms/[id]` (Facebook), `root/connections` | partial: no app-check button |
| `root/meta/usage` (Graph usage) | `api.meta.requestsPerMinute` key only | missing: `graph_usage` has no reader |
| `root/plans` | `root/plans` | done |
| `root/platforms`, `[platform]` | `root/platforms`, `[id]` | done |
| `root/privileges` | `root/privileges` | done |
| `root/registration` | `root/registration` | done |
| `root/sessions` | `root/sessions` | done |
| `root/status`, `root/worker` | `root/operations` (job health) | partial |
| `root/users` | `root/users` | done |
| `root/workspaces`, `[id]` | `root/workspaces` (+ `api/root/workspaces/[id]/access`) | done |
| `bio/[slug]` | `bio/[slug]/view` | done |
| `changelog`, `help`, `pricing`, `privacy-policy`, `status`, `terms`, `data-deletion` | same paths | done (source + render/route tests, 2026-10-22): `src/modules/history/ui/public-pages.tsx`, Root keys `public.siteEnabled/operator/content`; EN/FR; help/pricing/status/changelog gated by `public.siteEnabled`, legal pages always public; data-deletion keeps the confirmation-code lookup |
| `invite/[token]` | `join` | done |
| `page.tsx` (landing) | `page.tsx` | done |
| `settings/config` (owner config) | `root/config` | done |
| `setup` | none; owner via `scripts/admin/set-root.ts` / `prod-owner-reset-link.sh` | partial: bootstrap is a script |
| `share/[token]` | `share/[token]/view` | done |

## 3. Route handlers (`route.ts`)

Rebuild paths are relative to `rebuild/src/app/`.

| Legacy route(s) | Rebuild equivalent | Status |
| --- | --- | --- |
| `.well-known/oauth-*` | same paths | done |
| `api/account` (+ `password`, `sessions`, `sessions/[id]`) | `api/settings/account`, `account/sessions` | done |
| `api/accounts/[id]`, `[id]/sync` | `api/settings/connections`, `api/connections` | done |
| `api/ads` | `api/ads/*` | done |
| `api/agency/access` | `api/agency` | done |
| `api/ai-agents`, `[id]` | none | missing |
| `api/ai`, `ai/image`, `ai/video`, `ai/voice` | `api/ai` (text); `api/ai/media`, `api/ai/image`, `api/ai/video`, `api/ai/voice` → `modules/ai/content-tools/server/{media,http}.ts`; screen `/publishing/ai-studio` | done (2026-10-22: provider ports, Root policies `ai.imagePolicy`/`ai.voicePolicy`/`ai.videoPolicy`, exact confirmations, hourly/budget metering, library save; `tests/ai-media-generation.test.ts`, `tests/ai-media-ports.test.ts`; no live provider call; worker wiring of `pollAiVideos` open) |
| `api/analytics/[targetId]`, `analysis`, `export`, `pinned`, `post/[id]`, `refresh` | `api/analytics`, `explorer`, `comparison`, `demographics`, `pins`, `posts`, `report-workflows/*` | done |
| `api/api-tokens`, `[id]` | `api/settings/mcp-keys`, `account/person-keys`, `api/v1/*` | partial: legacy tokens not migrated |
| `api/auth/login`, `logout`, `register`, `verify-email` | `api/auth/sign-in`, `sign-out`, `register`, `verify-email(/resend)` | done |
| `api/auth/passkeys/*` | `api/auth/passkey/*`, `api/settings/account/passkeys` | done |
| `api/auth/password-reset`, `confirm` | `api/auth/recovery/request`, `reset` | done |
| `api/auth/two-step/*` | `api/auth/two-step/*`, `api/settings/account/security/*` | done (trusted-devices `devices` route: partial) |
| `api/bio` | `api/sharing/bio` | done |
| `api/calendar-feed/[token]`, `calendar-feeds`, `[id]` | same paths | done at source (token ICS, revocable; parity exception row for the bearer read; no real calendar-client run) |
| `api/caption-tests/[id]/learn` | `api/caption-tests/[id]/learn` → `modules/caption-tests/server/service.ts` `learnCaptionTest`; MCP `learn_from_caption_test` | done (2026-10-22: appends the winner to the workspace voice, not per-channel voice; `tests/caption-tests-service.test.ts`) |
| `api/chart-notes`, `[id]` | none | missing |
| `api/chat-channels`, `[id]`, `[id]/test` | none | missing (Slack/Telegram) |
| `api/connections/ads/[id]`, `instagram/[id]` | `api/settings/connections` | done |
| `api/content-mix` | `api/publishing/content-mix` | done |
| `api/cron/tick` | worker `scripts/worker.ts` | obsolete: external cron trigger replaced by worker |
| `api/custom-fields`, `[id]` | `api/publishing/custom-fields/*` | done |
| `api/engagement/comments`, `messages`, `sync`; `api/inbox`, `assign`, `notes*` | `api/inbox/*` | done |
| `api/errors` | `api/errors` | done (source + mocked tests): `src/app/api/errors/route.ts`, `src/server/errors/client-report.ts`; Root-bounded rate limit and size; parity exception recorded in MCP_PARITY.md |
| `api/exports`, `[id]` | `api/settings/data/exports`, `snapshot` | partial |
| `api/facebook/connect`, `callback` | `api/connections/[platform]/start`, `callback` (+ `api/oauth/connections/[platform]/start`) | done; Meta redirect URI must be updated to the new callback |
| `api/facebook/data-deletion`, `deauthorize` | none | **missing (gap 1)** |
| `api/feeds`, `[id]` | `api/feeds/*` (+ WordPress) | done |
| `api/health` | `api/health` | done (source + mocked tests): `src/app/api/health/route.ts`, `modules/history/server/health.ts`; scripts still probe `/sign-in` and legacy health until the release owner rewires them |
| `api/instagram` | `platforms/instagram` discovery only | partial |
| `api/key-dates`, `seasons` (+ `[id]`) | `api/key-dates`, `api/seasons` (+ `[id]`), `api/chart-notes`, `api/calendar/trends` | done at source; MCP_PARITY rows `*_calendar_*` |
| `api/labels`, `[id]` | `api/publishing/labels/*` | done |
| `api/link-preview` | `api/publishing/link-preview` → `modules/ai/content-tools/server/checks.ts` `linkPreview`; MCP `get_link_preview` | done (2026-10-22: neutral SSRF-guarded HTML fetch under Root `ai.linkPreviewPolicy`; the legacy Facebook re-scrape `refresh` option is not carried: it belongs to a Facebook-module hook; `tests/ai-composer-checks.test.ts`) |
| `api/mcp` | `api/mcp` | done |
| `api/media`, `[id]`, `[id]/raw`, `import` | `api/media`, `api/media-library/*` | done |
| `api/moderation/rules*`, `actions/[id]/undo` | `api/inbox/moderation` | done |
| `api/networks/[network]/connect|callback`, `bluesky`, `telegram` | none | missing |
| `api/notifications` | `api/notifications` | done |
| `api/oauth/authorize`, `register`, `token` | same | done |
| `api/page-goals` | `api/analytics/goals` | done |
| `api/page-groups`, `[id]` | `api/settings/profiles` | done |
| `api/post-notes/[id]`, `posts/[id]/notes` | `api/publishing/notes/*` | done |
| `api/post-templates*`, `snippets*` | `api/publishing/templates/*` | done (snippets folded into templates: partial) |
| `api/posts`, `[id]`, `approve`, `publish`, `retry`, `remove`, `purge`, `undo-send` | `api/publishing/posts/*`, `[id]/[action]`, `[id]/deletion`, `recovery` | done |
| `api/posts/[id]/duplicate`, `first-comment`, `recycle`, `versions`; `actions`, `bulk`, `export` | `api/publishing/duplicate`, `first-comments/*`, `recycle`, `versions`, `posts/bulk`, `export` | done |
| `api/posts/outlook`, `spam-check` | `api/publishing/outlook`, `api/publishing/spam-check` → `modules/ai/content-tools/server/checks.ts`; MCP `get_engagement_outlook`, `check_post_spam_risk` | done (2026-10-22: outlook reads platform-module `postPerformance`; spam uses workspace `spamGapMinutes`; both inside channel grants; composer embed pending, screen at `/publishing/ai-studio`; `tests/ai-composer-checks.test.ts`) |
| `api/queue`, `queue-slots` | `api/publishing/queue`, `queue-slots` | done |
| `api/report-schedules*`, `report-templates*`, `reports` | `api/analytics/report-workflows/*`, `api/reports/export` | done |
| `api/root/alerts/test` | none | missing |
| `api/root/app-check` | `api/root/diagnostics` | partial |
| `api/root/changelog*` | `api/root/changelog`, `api/root/changelog/[id]` | done (source + mocked tests): exact confirmations, Root actor recheck and transactional audit |
| `api/root/client-invitations*` | none | missing |
| `api/root/config*`, `adopt`, `ai-models`, `test-email` | `api/root/config`, `diagnostics` | done (adopt obsolete: `import-legacy-config.ts`) |
| `api/root/connections/health` | `api/root/connections*` | done |
| `api/root/errors/[id]` | `api/root/errors*` | done |
| `api/root/invitations`, `members`, `subscribers`, `plans`, `privileges`, `sessions`, `users*`, `workspaces*`, `visit`, `transfer` | `api/root/registration*`, `plans*`, `privileges*`, `sessions*`, `users*`, `workspaces*`, `lifecycle*`, `installation` | done |
| `api/saved-replies*`, `saved-views*` | `api/inbox/productivity`, `api/publishing/saved-views*` | done |
| `api/settings/config*` | `api/root/config` | done |
| `api/setup` | none | partial (script) |
| `api/share-links*`, `share/[token]` | `api/sharing/*`, `share/[token]` | done |
| `api/structured-data` | none | missing |
| `api/targets/[id]`, `profile` | `api/settings/profiles` | done |
| `api/tasks*`, `team*`, `workspace`, `switch` | `api/tasks*`, `api/settings/team*`, `api/workspaces/select` | done |
| `api/v1/pages`, `pages/[id]/analytics`, `posts`, `webhooks*` | `api/v1/pages`, `analytics/[operation]`, `posts*`, `webhooks*`, `ads/[operation]`, `me` | done |
| `api/webhook-deliveries/[id]/redeliver`, `webhooks*` | `api/webhooks/[id]/deliveries*`, `secret*`, `test` | done |
| `bio/[slug]/go/[id]`, `l/[slug]` | `bio/[slug]/go/[id]`, `s/[slug]` | done (short-link path changed `/l/` -> `/s/`; old printed links break) |

## 4. Library features (`src/lib/**`)

Rebuild evidence paths under `rebuild/src/`.

| Legacy lib file(s) | Rebuild equivalent | Status |
| --- | --- | --- |
| `auth`, `sessions`, `totp`, `two-step`, `passkeys`, `crypto`, `email-tokens`, `rate-limit`, `client-ip`, `owner-guard` | `server/auth*.ts`, `two-step.ts`, `totp.ts`, `secret-crypto.ts`, `rate-limit.ts`, `client-ip.ts` | done |
| `email/*`, `notify`, `invite-path` | `server/mail/*`, `modules/settings/notifications/*` | done (live SMTP unproven) |
| `posts`, `post-bulk`, `post-versions`, `post-version-diff`, `post-notes`, `post-templates*`, `queue-actions`, `first-comment`, `approvals`, `composer-state`, `evergreen`, `stagger`, `links`, `slug`, `best-times`, `queue-suggestions`, `content-mix` | `modules/publishing/**` | done |
| `facebook/publish`, `graph`, `oauth`, `permissions`, `insights`, `edges`, `metrics`, `ads`, `analytics`, `budget*`, `call-source`, `opengraph` | `platforms/facebook/**` | done / partial (opengraph preview missing); Group publishing dropped: Meta removed the Groups API 2024-04-22 |
| `facebook/instagram*`, `instagram` | `platforms/instagram/{discovery,analytics}.ts` | partial (no publishing) |
| `networks/*` (9 connectors) | none | missing |
| `inbox`, `inbox-notes`, `inbox-response`, `moderation*`, `reply-template`, `response-time`, `negative-comments`, `mentions` | `modules/inbox/**`, `modules/ai/server/sentiment.ts` | done |
| `analytics*`, `audience*`, `aggregate`, `channel-figures*`, `page-analysis*`, `network-analytics`, `network-rules`, `pinned-metrics`, `page-goals`, `goals`, `label-report`, `link-analytics`, `reports`, `report-*`, `analytics-export`, `ads-analysis` | `modules/analytics/**`, `modules/ads/**` | done / partial |
| `engagement-prediction`, `engagement-outlook` | `modules/ai/content-tools/pure.ts` `predictEngagement`, `server/checks.ts` | done (2026-10-22) |
| `caption-test` | `modules/caption-tests/{pure.ts,server/service.ts}` | done (2026-10-22; composer A/B creation still belongs to Publishing, tests start from existing posts) |
| `engagement` | none | missing |
| `chart-notes`, `chart-note-colors` | `modules/calendar-extras` (notes service, `/analytics/notes`, chart marks) | done at source |
| `key-dates*`, `seasons`, `holidays`, `trends` | `modules/calendar-extras` (+ queue allocator season hook in `executors.ts`) | done at source |
| `ics`, `calendar-feeds`, `calendar-days` | `modules/calendar-extras/server/{ics,subscriptions}.ts`, `lib/calendar-dates.ts` | done at source |
| `spam-guard` | `modules/ai/content-tools/pure.ts` `assessSpamRisk`, `server/checks.ts` `spamCheck` | done (2026-10-22) |
| `chart-notes`, `chart-note-colors` | `modules/calendar-extras` (notes service, `/analytics/notes`, chart marks in Analytics overview and Explorer) | done at source |
| `ai`, `ai-providers`, `ai-models`, `ai-prices`, `ai-agents` | `modules/ai/**` (providers/models/limits); prices/monthly budget now in `modules/ai/server/usage.ts` (source); agents none | partial |
| `ai-image`, `ai-video`, `ai-voice`, `voice-names` | `modules/ai/content-tools/server/{media,media-openai,media-gemini,media-ports}.ts`; voice names are the Root `ai.voicePolicy.voices` list | done (2026-10-22) |
| `text-backgrounds`, `alt-text`, `translation`, `translated-posts` | `modules/ai` translate kind only | missing / partial |
| `chat` | none | missing |
| `system-alerts`, `error-tracking`, `uptime`, `health`, `housekeeping`, `background-refresh` | worker jobs + `server/root/*`; no alert/error/uptime writer | partial (gap 3) |
| `media`, `image-format`, `image-variants`, `media-links`, `zip`, `workspace-export` | `modules/media/**`, `server/data-control/**`, `modules/settings/server/exports.ts` | done / partial |
| `bio`, `share-links`, `agency*`, `tasks`, `task-workflow`, `team`, `role-access`, `scope-abilities`, `page-access`, `page-groups`, `page-filter`, `selection`, `custom-fields`, `feeds`, `rss/*`, `webhooks`, `api`, `public-api`, `api-tokens` | corresponding modules; `api-tokens` replaced by MCP/person keys | done; `api-tokens` partial |
| `root*`, `operator`, `site`, `setup`, `meta-app`, `plans`, `settings/*`, `config-draft`, `modules`, `env` | `server/root/**`, `server/config/**`, `lib/config/**` | done / partial (`operator`, `site`, `setup` missing) |
| `activity`, `history` | writers in many modules; reader `modules/history/server/history.ts` | done (reader added 2026-10-22; retention follows `root.auditRetentionDays` for activity only) |
| `scheduler/*` | `server/jobs/**`, `scripts/worker.ts` | done |
| `structured-data*`, `safe-fetch`, `holidays` data, `world-map.json`, `palette`, `themes`, `brand`, `languages`, `time`, `text`, `csv`, `json`, `paging`, `validation` | `lib/themes.ts`, per-module helpers; structured-data and world-map not carried | partial (structured data/world map missing) |

## 5. Prisma models (legacy `prisma/schema.prisma`)

"Rebuild use" is raw SQL or the rebuild Prisma client (`rebuild/prisma/schema.prisma` maps 31 models). Table references found by grep of `FROM/JOIN/INTO/UPDATE` in `rebuild/src`.

| Models | Rebuild use | Status |
| --- | --- | --- |
| User, Session, Workspace, Membership, Passkey, RecoveryCode, McpApiKey, SocialAccount, Target, Post, PostTarget, PostComment, Conversation, ConversationMessage, PageInsight, InstagramAccount/Media/Insight, AdAccount, AdInsight, AppSetting, WorkspaceDataPurge, SavedView | Prisma client | done |
| EmailToken, Invitation, PostVersion, InboxNote, BioPage, BioLink, Task, CustomField, PostFieldValue, PostNote, PageGoal, QueueSlot, PageGroup, PageGroupTarget, MemberPageAccess, Label, PostLabel, FeedSource, FeedItem, ShortLink, LinkClick, NotificationSetting, NotificationMute, EmailLog, PageReview, ExternalPost, Media, ActivityLog, PostTemplate, SavedReply, ShareLink, ReviewDecision, ReportTemplate, ReportSchedule, WebhookEndpoint, WebhookDelivery, RootActivity, TrustedDevice, ModerationRule, ModerationAction, ContentMixRule, Plan, WorkerHeartbeat | raw SQL | done |
| BackupRun, SystemAlert, ErrorEvent | read only | partial (no writers in rebuild) |
| MetricAvailability, PageVideo | export/purge only, no product reader | partial |
| WorkspaceExport | replaced by `rebuild_workspace_exports`; old rows obsolete | obsolete: new async ZIP service |
| OAuthClient, OAuthCode | replaced by `mcp_oauth_clients/codes` | obsolete: not migrated (gap 10) |
| RebuildReportRun (`report_runs`) | `modules/analytics/reports` | done |
| AiAgent, AiGeneration, CalendarFeed, ChartNote, ChatChannel, ClientInvitation, ApiToken, Snippet, UptimeDay, PublicHoliday, HolidayYear, TrendingTopic, KeyDate, SeasonalMode, ChangelogEntry, WorkerJobRun, GraphUsage | not referenced | missing (feature absent); keep the tables |

## 6. Root settings and env

Legacy `app_settings` keys (`src/lib/settings/definitions.ts`) vs rebuild registry.

| Legacy key(s) | Rebuild key | Status |
| --- | --- | --- |
| `app.url` | `app.publicOrigin` (+ `mail.publicOrigin`) | done |
| `auth.openRegistration`, `auth.loginAttempts`, `auth.loginWindowMinutes`, `security.twoStep` | same keys | done |
| `limits.workspaceRequestsPerMinute` | `security.apiRequestsPerMinute`, `mcp.requestsPerMinute` | partial |
| `i18n.defaultLocale` | none (EN/FR catalogs; `theme.default*` only) | missing |
| `cron.secret` | none | obsolete: `api/cron/tick` removed |
| `operator.*` (10 keys), `site.public` | none | missing (gap 2) |
| `facebook.appId/appSecret/graphVersion/graphBaseUrl/scopes/requestTimeoutSeconds` | `meta.appId/appSecret/graphVersion/graphBaseUrl/oauthScopes/requestTimeoutMs` | done (imported) |
| `facebook.uploadTimeoutSeconds` | `facebook.native.*` keys | partial |
| `features.groups/messaging/instagram/ads` | `ads.managementEnabled`, module/platform enablement | done (groups dropped: Meta API removed) |
| `scheduler.pollSeconds/concurrency/maxAttempts/staleLockMinutes` | `jobs.enabled`, `jobs.order`, `notifications.maxAttempts`, worker keys | partial |
| `scheduler.rssPollMinutes`, `evergreenCheckMinutes`, `nativeReconcileMinutes`, `tokenExpiryCheckHours`, `bulkRowLimit` | `feeds.autoCheck.*`, `publishing.automation.*`, `notifications.connectionWarningDays`, `publishing.maxImportRows` | done |
| `analytics.refreshHours/pageInsightsHours/edgeSyncHours/instagramSyncHours/adsSyncHours/postBatch/commentPostLimit/videoLimit/edgeWindowDays/adWindowDays/tokenWarningDays` | `meta.postHistoryPolicy`, `meta.pageInsightMetrics`, `data.insightDefaultDays`, `inbox.sync*`, `notifications.connectionWarningDays` | partial (per-key equivalence not audited) |
| `networks.*`, `tiktok.*`, `youtube.*`, `linkedin.*`, `threads.*`, `x.*`, `pinterest.*` | q-31: module-owned Mastodon/Threads/X settings registered through PLATFORM_CONFIG; other networks unchanged | partial: adapter settings exist for three staged providers, not legacy-key import equivalence or usable customer connectors; see their config.ts and READMEs |
| `ai.provider/apiKey/model/openaiKey/geminiKey` | `ai.provider`, `ai.apiKey`, `ai.model`, `ai.openaiApiKey`, `ai.geminiApiKey` (+ models/endpoints) | done (imported) |
| `ai.rateLimitPerHour` | `ai.hourlyRequestsPerWorkspace` | done |
| `ai.monthlyBudgetUsd`, `ai.priceOverrides` | `ai.monthlyBudgetUsd`, `ai.priceOverrides`, `ai.fallbackInputPricePerMillionUsd`, `ai.fallbackOutputPricePerMillionUsd`, `ai.charactersPerToken` | done in source (mocked tests; estimated tokens, not provider-reported; no live run) |
| `alerts.email/telegramBotToken/telegramChatId/publishFailures/diskPercent` | `notifications.*` (in-app/email) | partial: no Telegram, disk alerts |
| `email.provider/smtp*/apiKey/from` | `mail.*` | partial: HTTP API provider (`email.apiKey`) not carried |
| `links.shortenerDomain` | `publishing.shortLinkBaseUrl` | done |
| `retention.activityDays/emailDays/clickDays/aiDays/sweepHours` | `retention.auditDays/syncLogDays/analyticsDays`, `root.auditRetention*` | partial |
| `media.dir`, `media.workspaceQuotaMb`, `media.maxUploadMb`, `media.retainUnusedDays` | `storage.mediaRoot` (default empty: must be set), `media.workspaceQuotaBytes`, `publishing.maxImageUploadBytes`, `media.videoMaxBytes` | partial (retainUnusedDays missing) |

Env (`.env.example`): `DATABASE_URL`, `ENCRYPTION_KEY` used. `SESSION_SECRET`: no `process.env.SESSION_SECRET` in `rebuild/`, but `prod-cutover.sh` still copies it (unused leftover). `TRUST_PROXY`, `PORT` used (`HOST`, `APP_PORT`, `POSTGRES_PASSWORD` are Docker/legacy). Rebuild also reads `APP_URL`, `LOGIN_ATTEMPTS`, `LOGIN_WINDOW_MINUTES`, `SECURITY_TWO_STEP` (import script / seeds only).

## 7. Data tables still needed for migration

Must remain intact and readable (rebuild reads or writes them): users, sessions, workspaces, memberships, invitations, email_tokens, social_accounts, targets, posts, post_targets, post_versions, post_notes, post_labels, labels, post_field_values, custom_fields, post_templates, queue_slots, content_mix_rules, media, short_links, link_clicks, feed_sources, feed_items, bio_pages, bio_links, share_links, review_decisions, tasks, page_groups, page_group_targets, member_page_access, page_goals, page_insights, post_comments, page_reviews, conversations, conversation_messages, inbox_notes, saved_replies, saved_views, moderation_rules, moderation_actions, external_posts, instagram_accounts/media/insights, ad_accounts, ad_insights, notification_settings, notification_mutes, email_logs, activity_logs, root_activities, plans, report_templates, report_schedules, webhook_endpoints, webhook_deliveries, mcp_api_keys, passkeys, recovery_codes, trusted_devices, app_settings, workspace_data_purges, worker_heartbeats, backup_runs, system_alerts, error_events, metric_availability (export/purge), page_videos (export/purge), `_prisma_migrations`, and all `rebuild_*` tables.

Do not drop until a decision is recorded (feature missing, data may still be wanted): ai_agents, ai_generations (usage/budget history), ai_videos, calendar_feeds, chart_notes, caption_tests, chat_channels, client_invitations, api_tokens, snippets, uptime_days, public_holidays, holiday_years, trending_topics, key_dates, seasonal_modes, changelog_entries, worker_job_runs, graph_usage.

Safe to retire after backup + verification: workspace_exports (replaced), oauth_clients/oauth_codes (replaced; connectors must re-register).

## 8. References to legacy paths that cleanup must handle

| Location | Reference | Cleanup note |
| --- | --- | --- |
| `rebuild/scripts/prod-cutover.sh:30,41,43,50,55,56,63` | `/srv/ms-social-pilot/.env`, services `social-pilot`, `social-pilot-worker` | Historical one-shot cutover script; archive or delete after rollback window |
| `rebuild/scripts/prod-stage-drill.sh:6,30` | `/srv/ms-social-pilot`, legacy env | Same |
| `rebuild/scripts/prod-rollback-drill.sh:17,72,110,145,151` | `LEGACY=/srv/ms-social-pilot`, legacy `/api/health`, dumps `socialpilot-deploy-*` | Retire with the legacy release; keep a rebuild-only drill |
| `rebuild/scripts/prod-deploy.sh:32` | backup dir `/var/backups/socialpilot-deploy-$T` | Name only; rename deliberately (the drill's `find` pattern depends on it) |
| `rebuild/scripts/prod-deploy.sh:19-57` | root `prisma/migrations`, root `npm ci` | Gap 5: relocate migrations/lockfile first |
| `rebuild/package.json` (`test`, `worker`) | `../node_modules/.bin/vitest`, `../.env` | Gap 5 |
| `rebuild/src/server/auth.ts` etc. | `hashLegacySessionToken`, `hashLegacyPassword` | Compatibility with migrated credentials: keep |
| `rebuild/prisma/schema.prisma`, `docs/DATA_COMPATIBILITY.md` | "parent app" schema `app/prisma/schema.prisma` | Doc wording only |
| `rebuild/src/server/root/legacy/*`, `rebuild/src/modules/root/server/*` | named "legacy" but live Root services | Rename later, not delete |
| `rebuild/docs/CUTOVER.md` lines 9, 13, 237, 276, 414, 556-562 | `/srv/ms-social-pilot`, `socialpilot-deploy` | Update when legacy is removed (some lines say production is still legacy; stale) |
| Root `scripts/deploy/*` (`deploy.sh`, `rebuild-*.sh`, `remote-*.sh`, `server-deploy.sh`) and root `package.json` `deploy*` scripts (`socialpilot-deploy` target) | Legacy deploy, guarded | Delete after confirming no rebuild script sources them |
| Root `scripts/server/*` | Host backup source (gap 4) | Move to `rebuild/scripts/server/` before deleting |
| Root `src/`, `messages/`, `e2e/`, `tests/`, `Dockerfile`, `docker-compose.yml`, `scripts/{setup,start,worker}`, `scripts/admin/*`, `scripts/dev/*`, `docs/LEGACY_AGENT_GUIDE.md`, `AGENTS.md`/`CLAUDE.md` legacy wording | Legacy app | Removable once gaps 1-10 are resolved or accepted; `scripts/admin/set-root.ts` is the only owner bootstrap (port first) |
| Host: `/srv/ms-social-pilot` (rollback release), systemd `social-pilot`, `social-pilot-worker` (disabled), `/usr/local/sbin/ms-social-pilot-{backup,offsite,restore-test}`, `/etc/cron.d/ms-social-pilot-offsite`, `/etc/ms-social-pilot/offsite.env` | Legacy release and host tooling | Keep until rollback window ends; backup tooling stays |

## 9. Notes on this lane

- Owned file only; no source, config, migration or MCP_PARITY edits. The small fixes asked for were not made because every candidate (health route, deletion callbacks, error recorder, legal pages) is a new feature outside the owned path.
- Counts are from grep; a legacy feature implemented under a different name may be misreported as missing. Verify rows marked missing against the owning module before scheduling work.
- Suggested additions to LEGACY_CAPABILITY_PARITY.md: rows for gaps 1-3, 7 and 9.


## LinkedIn / Pinterest platform lane — 2026-10-22

| Legacy surface | Rebuild evidence | Status |
| --- | --- | --- |
| `src/lib/networks/linkedin.ts`; network connect/callback | `src/platforms/linkedin/{manifest,config,adapter,transport,runtime,connection,oauth-state,host}.ts`; `tests/networks-linkedin-pinterest.test.ts`, `tests/networks-connection.test.ts` | Adapter/connection source done with synthetic fixtures; staged in `src/platforms/index.ts`, dispatch installation pending central-file ownership. Member/company discovery, text/article/images and scoped status; no live evidence. Custom article preview metadata needs a neutral host extension. |
| `src/lib/networks/pinterest.ts`; network connect/callback | `src/platforms/pinterest/{manifest,config,adapter,transport,runtime,connection,oauth-state,host}.ts`; same fixture/security tests | Adapter/connection source done; staged registration, host installation pending. Boards, single/multi-image Pins, status/delete and refresh exchange implemented. Automatic near-expiry refresh and atomic destination credential rotation remain open; legacy parity is partial. |

Both modules register six typed Root entries; configuration schema version unchanged.
No UI screen changed, new route/tool/table, server, deployment, production access,
commit or push. Module READMEs contain the exact required host-registration and
parity/status documentation edits for the integrator. The broad non-Facebook gap
above is not marked done by these two staged implementations.

Lane verification (rebuild directory; synthetic/mocked evidence only):

- `npx tsc --noEmit -p .`: zero errors.
- `npx vitest run --no-cache tests/networks-linkedin-pinterest.test.ts tests/networks-connection.test.ts tests/networks-runtime.test.ts tests/platform-modules.test.ts tests/parity-guard.test.ts tests/config-validation.test.ts`: six files, 103 tests passed.
- `npx vitest run --no-cache --exclude "**/facebook-diagnostic-transport.test.ts"`:
  656 files passed, 49 skipped, one failed; 10,204 tests passed, 2,153 skipped,
  five failed. All failures are in `facebook-native-http.test.ts`, where the
  sandbox refuses loopback binding (`listen EPERM ::1`). Full suite is not green.
- Vitest caching was disabled because linked `node_modules/.vite` is outside the
  writable sandbox; the initial cached runs passed assertions but exited on cache
  write EPERM. No sandbox policy or unrelated dependency path was changed.
