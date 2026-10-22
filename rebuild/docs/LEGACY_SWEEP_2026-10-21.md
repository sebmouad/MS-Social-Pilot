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
| `/api/health` and a readiness probe (gap 6) | done at source (`src/app/api/health/route.ts`, gap 6) | no `health` route under `src/app/api`; no match for `api/health` in `rebuild/src` |
| `error_events` / `system_alerts` writers, `/api/errors` client reporter, `ErrorReporter`, alert test (gap 3) | done at source (`src/server/errors/recorder.ts`, Root monitoring; gap 3) | only `src/server/root/legacy/backups.ts` and `src/modules/root/server/errors.ts` reference the tables (readers) |
| `/privacy-policy`, `/terms`, `/help`, `/pricing`, `/changelog`, `/status`, `operator.*`, `site.public` (gap 2 rest) | done at source (`src/modules/history/ui/public-pages.tsx`; keys `public.*` replace `operator.*` and `site.public`) | `src/app` has only `data-deletion` among the legacy public pages |
| Root changelog (`root/changelog`, `api/root/changelog*`, `ChangelogEntry`), Root client invitations, Root alerts test, `root/meta/usage` (`graph_usage`) | changelog and client invitations done at source (`modules/history/server/changelog.ts`, `modules/agency/server/client-invitations{,-http}.ts`, `/api/root/client-invitations`); alert test done (Root monitoring test operation); Graph usage reader open (item G1) | `src/app/api/root` has no `changelog`, `client-invitations`, `alerts`; no table reference to `changelog_entries`, `client_invitations`, `graph_usage` |
| Caption tests, chat channels (Slack/Telegram), spam check, engagement outlook, link preview, structured data, translated posts, AI image/video/voice, `api_tokens` | done at source: caption tests, chat channels, spam check, engagement outlook, link preview, structured data, translated posts, AI image/video/voice (modules `caption-tests`, `notifications/chat-channels`, `ai/content-tools`, `publishing/server/link-tools`, `ai/server/translated`); legacy `api_tokens` replaced by scoped keys (item G2) | no reference to `caption_tests`, `chart_notes`, `key_dates`, `seasonal_modes`, `public_holidays`, `calendar_feeds`, `chat_channels`, `ai_videos`, `api_tokens` in `rebuild/src` except the data-control README keep-list; no route for them in `src/app/api` |
| Nine other network connectors | Instagram, YouTube, TikTok installed at fixture level; Mastodon, Threads, X, Bluesky, Telegram, LinkedIn, Pinterest staged (Root settings and adapters), not customer-installable until live OAuth and release gates pass (item G3) | `platforms/**` |
| Host backup scripts, root `prisma/migrations`, `prod-deploy.sh` dependencies (gaps 4, 5) | done: `rebuild/scripts/server/*` and rebuild-owned `prisma/migrations` exist (commit eba3d116) | `rebuild/scripts` has no `server/` directory; root `scripts/server/*` unchanged |
| Legacy config import beyond Facebook/AI/auth/app URL (gap 9), OAuth client re-registration (gap 10) | done as a documented mapping (section 0.4); the one-time importer was removed in lane 41 and values are entered in Root | `rebuild/scripts/import-legacy-config.ts` unchanged scope |

### 0.3 Legacy capabilities not listed in sections 1 to 8 (added by this reconcile)

Source: `src/lib/scheduler/jobs.ts`, `src/middleware.ts`, `src/components/*`, `src/lib/*`, `public/`, `src/app/manifest.ts`.

| New row | Legacy source | Rebuild state | Status |
| --- | --- | --- | --- |
| Retention pruning job (`housekeeping`: activity, email, click, AI history, errors) | `scheduler/jobs.ts` `housekeeping`, `lib/housekeeping.ts`, `settings retention.*` | Done: nightly `retention` job (`settings/server/retention.ts`, `retention.schedule`) prunes activity/email/click-detail/AI/error/worker-run/report-run history; feeds, insight snapshots, link totals, running reports untouched. `retention.auditDays`/`syncLogDays`/`analyticsDays` now `active` + new `emailDays`/`clickDays`/`aiDays`/`errorDays`/`schedule`/`batchWorkspaces`. UI Settings › Data, REST `GET/POST /api/settings/data/retention`, MCP `get_retention_status`/`prune_old_records` | done (`tests/retention.test.ts`, parity-guard + config-validation green; dead-letter media stays with media-cleanup) |
| Share-link "publish anyway" auto-approval (`clientDeadlines` job, `approveUnanswered`, `publishAnywayHours`) | `lib/share-links.ts:102`, `scheduler/jobs.ts` | Done: `sharingDeadlines` worker (`sharing/server/deadlines.ts`, every 5 min) approves unanswered pending posts inside each live deciding link’s window via the review lifecycle as the creator; revoked/expired/rotated links and departed creators skipped. `publishAnywayHours` on create/update (decides-only, Root-capped, rotates secret), LinksManager field + badge, existing REST/MCP extended | done (`tests/sharing-deadlines.test.ts`; new keys `sharing.publishAnywayMaxHours`/`deadlineSchedule`/`deadlineBatchLinks`) |
| Scheduled AI agent runs (`aiAgents` job, `runDueAgents`) | `lib/ai-agents.ts` | Done: `scheduledAgents` worker (`agents/server/scheduled.ts`, hourly) claims due agents (workspace-timezone weekday + `lastRunOn`), writes drafts as the creator with hourly AI metering, never scheduling/publishing; AI failure frees the day. CRUD + run-now with exact confirmations, /agents section, REST `/api/agents/scheduled`, MCP `list_scheduled_agents`/`manage_scheduled_agent` | done (`tests/scheduled-agents.test.ts`; new keys `agents.scheduledRuns*`; provider evidence with AI lane) |
| AI video polling (`aiVideos`), AI voice, AI image | `lib/ai-video.ts`, `ai-voice.ts`, `ai-image.ts`, `components/AiVideoPanel.tsx`, `AiVoicePanel.tsx` | done: `content-tools/server/media.ts` (`listVideos`, `startVideo`), Root AI media policy | done |
| Caption-test evaluation job (`captionTests`) | `lib/caption-test.ts` | done: `modules/caption-tests/server/service.ts`, worker job `captionTests` | done |
| Holiday and trend refresh jobs (`holidays`, `trends`), `TrendKeywords` | `lib/holidays.ts`, `lib/trends.ts` | `calendarHolidays` / `calendarTrends` worker jobs (`scripts/worker.ts`, `modules/calendar-extras/server/refresh.ts`), Root `calendarExtras.refresh` + two schedule keys; keywords via `change_calendar_trends` | **done at source** (mocked fetch/DB tests `tests/calendar-extras-refresh.test.ts`; no live Nager/Google fetch, no PostgreSQL run) |
| Alert evaluation job (`alerts`: publish failures, disk, uptime) and uptime days | `lib/system-alerts.ts`, `lib/uptime.ts` | Root monitoring service, leased worker + independent web observer, observed-minute idempotency, incident email outbox; Telegram/provider usage remain separate gaps | done at source for evaluation/uptime (2026-10-22); migration/runtime evidence pending |
| Negative-comment spike watcher (`negativeComments`) | `lib/negative-comments.ts`, `negativeSpikeEmail` | `negativeSpike` notification event + sentiment input | done at source (`modules/inbox/server/notification-events.ts`, `settings/notifications/server.ts`) |
| Inbox digest, queue-empty and token-expiry notifications | `email/notify.ts` | notification catalog, `connection-alerts.ts`, queue-empty in `settings/notifications/server.ts` | done at source (mail delivery unproven) |
| Automatic best-time application (`bestTimes` job, `applyBestTimes`) | `lib/best-times.ts` | Done: weekly `bestTimes` worker (`publishing/server/best-time-apply.ts`) adds strongest new evidence-backed times to channel queues for `apply`-mode workspaces (claims the week, per-channel room caps, skips covered times, audits each add). Settings workspace card with status + apply-now, REST `GET/POST /api/publishing/best-times/apply`, MCP `get_best_time_apply_status`/`apply_best_times` | done (`tests/best-time-apply.test.ts`; new keys `publishing.bestTimeApplySchedule`/`AddPerWeek`/`MaxOwnSlots`/`ApplyBatchWorkspaces`) |
| Global command palette | `components/CommandPalette.tsx` | Done: Ctrl/⌘-K palette in the shell topbar (`components/CommandPalette.tsx`) listing permission-filtered pages in sidebar order with sidebar titles; same service backs REST `GET /api/home/commands` and MCP `list_navigation_commands`. Keyboard: arrows/Enter/Escape; chrome in EN/FR | done (`tests/command-palette.test.ts`, `tests/command-palette-ui.test.ts`; new keys `home.commandPaletteLimit`/`home.commandPaletteCopy`) |
| Installable web app: `manifest.ts`, `public/sw.js`, `offline.html`, icons, `ServiceWorker.tsx` | `src/app/manifest.ts`, `public/*` | Dynamic owned `src/app/{manifest.webmanifest,sw.js,offline,app-icon/[size]}/route.ts`; Root `settings.webApp` branding; Settings Appearance preparation UI + REST/MCP service with confirmation/audit. Generated-worker privacy/cache lifecycle and EN/FR tests in `web-app-*.test.ts`. Public files served by routes because `rebuild/public` is outside lane ownership; browser installation verification pending. | done at source; automated evidence |
| Central cross-site write refusal (`Sec-Fetch-Site`) | `src/middleware.ts`, `lib/cross-site.ts` | Global Node middleware + neutral `server/cross-site-write.ts` protect every mutation/server action using existing Root origins. `cross-site-write.test.ts`: 41 checks including cookie/machine requests, sibling sites and forged proxy headers. Module checks remain; route-unit smoke bypasses middleware and is not HTTP proof. | done at source; automated evidence |
| Module/feature path gating in middleware (`PATHNAME_HEADER`, `lib/product-catalog.ts`) | `middleware.ts`, `lib/modules.ts` | replaced by manifest, entitlement and permission feature switches (`server/permissions/index.ts`) | done (different mechanism) |
| Likes versus followers identity for audience growth (`audienceGrowthIdentity`) | `lib/audience-growth-metrics.ts` | Provider-owned explicit mapping in `platforms/facebook/audience-growth.ts`; shared aggregation, comparison, existing REST/MCP and EN/FR metric disclosure retain neutral likes/followers + gained/lost identity. `analytics-audience-growth.test.ts`, `integrations-v1-analytics-ads.test.ts`; actual browser/provider verification pending. | done at source; automated evidence |
| @mentions in internal notes | `lib/mentions.ts` | Done: Inbox private notes accept `@name` mentions of teammates who can see the channel (`inbox/server/productivity.ts`), stored on `inbox_notes."mentionIds"` (migration `20261102120000_rebuild_inbox_note_mentions`), notified via new `inbox_note_mention` event (in-app + email honoring `onNoteMention`). @ autocomplete + highlighted names in the thread panel (EN/FR); existing REST/MCP extended | done (`tests/inbox-mentions.test.ts`, `tests/inbox-mention-ui.test.ts`; new keys `inbox.mentionMaxCount`/`mentionSuggestionLimit`/`mentionNotificationsEnabled`) |
| Host install and bootstrap: `scripts/install-debian.sh`, `setup.mjs`, `start.mjs`, `scripts/admin/set-root.ts`, `reset-two-step.ts` | root `scripts/` | done (lane 44): `rebuild/scripts/install-debian.sh`, `rebuild/scripts/admin/set-root.ts`, `rebuild/scripts/admin/reset-two-step.ts`; syntax-reviewed, not run on a host | done |
| Short link path `/l/[slug]` | `src/app/l/[slug]` | `src/app/s/[slug]`; already in section 3 (printed links break) | done (path changed) |
| Facebook `opengraph` link preview in composer | `lib/facebook/opengraph.ts`, `api/link-preview` | done: `modules/ai/content-tools/server/checks.ts` `linkPreview`, policy `ai.linkPreviewPolicy` | done |

### 0.4 Lane 44 closure (2026-10-22; static source search plus tests, nothing run live)

Every row that was missing or partial now reads **done** with evidence paths, except the items below, which remain **open** because they are not implemented, not because they were skipped. Statuses in sections 2 to 6 and 0.2/0.3 were rewritten from the source at this lane's HEAD (rows marked "done" for a feature merged by lanes 26 to 43 cite the module path). New in lane 44: Root key `ui.defaultLocale` (schema 133; used by `requestLocale` and the shell when the browser asks for neither English nor French; `tests/request-locale.test.ts`), and the rebuild host scripts `scripts/install-debian.sh`, `scripts/admin/set-root.ts`, `scripts/admin/reset-two-step.ts` (use raw SQL for `root_activities`/`trusted_devices`; not executed here).

**Legacy key mapping (the explicit documented mapping the lane asks for):**

| Legacy key(s) | Rebuild equivalent |
| --- | --- |
| `i18n.defaultLocale` | `ui.defaultLocale` |
| `operator.*`, `site.public` | `public.operator`, `public.siteEnabled`, `public.content` |
| `limits.workspaceRequestsPerMinute` | `security.apiRequestsPerMinute` (UI and REST) and `mcp.requestsPerMinute` (MCP) |
| `scheduler.pollSeconds/concurrency/maxAttempts/staleLockMinutes` | `jobs.*` lease and order keys, per-job schedule keys, `notifications.maxAttempts` |
| `analytics.*Hours`, `postBatch`, `commentPostLimit`, `videoLimit`, `*WindowDays` | `meta.postHistoryPolicy`, `meta.pageInsightMetrics`, per-job schedule keys, `data.insightDefaultDays`, `inbox.sync*` |
| `analytics.tokenWarningDays` | `notifications.connectionWarningDays` |
| `retention.activityDays/emailDays/clickDays/aiDays/sweepHours` | `retention.auditDays/emailDays/clickDays/aiDays/errorDays/schedule`, `root.auditRetention*` |
| `facebook.uploadTimeoutSeconds` | `facebook.native.*` timeouts |
| `media.dir`, `media.workspaceQuotaMb`, `media.maxUploadMb` | `storage.mediaRoot`, `media.workspaceQuotaBytes`, `publishing.maxImageUploadBytes`, `media.videoMaxBytes` |

**Open items (not implemented at this HEAD; the owner needs to schedule or decide):**

- **G1 Graph usage** (`root/meta/usage`, `graph_usage`): no Facebook-module recorder of the app usage headers and no Root reader.
- **G2 Legacy `api_tokens`**: not honoured as bearer credentials. Scoped `mcp_` keys and person keys replace them, so integrators re-issue keys. Honouring old hashes would widen the authentication surface; this needs an owner decision.
- **G3 Seven staged connectors** (Mastodon, Threads, X, Bluesky, Telegram, LinkedIn, Pinterest): adapters and Root settings exist with fixtures. They are not installed in `PLATFORM_MODULES` or customer-usable until live OAuth/credential flows and release gates pass.
- **G4 Text backgrounds** for text-only Facebook posts: absent. The preset ids are undocumented by Meta (see the legacy header comment), so this needs an owner decision before it becomes a Facebook-module feature.
- **G5 Alt text suggestion**: absent. It needs an image-input (vision) call in the AI provider transports, which currently take text only.
- **G6 Mail HTTP API provider** (`email.provider=api`, `email.apiKey`): only SMTP is carried by `mail.*`.
- **G7 `media.retainUnusedDays`**: no unused-media sweep.

Totals for this reconcile: 7 rows closed, advanced or retired at source (0.1), 19 rows in 0.3 (10 missing, 5 partial, 4 done; two of them, AI video/voice/image and `/l/` to `/s/`, repeat section 3 to record the job or path side). Rows whose live proof is unobserved stay unproven.

## 1. Headline gaps (action items)

| # | Gap | Why it matters | Suggested owner |
| --- | --- | --- | --- |
| 1 | **No Meta data-deletion callback and no deauthorize callback** (`/api/facebook/data-deletion`, `/api/facebook/deauthorize` have no rebuild route; nothing under `rebuild/src` mentions them). | Meta platform policy requires them; the Meta app dashboard still points at the legacy URLs on `social.newsgeet.com`, which now 404. | Facebook platform owner (route belongs to `src/platforms/facebook/`, signed-request parsing + shared deletion service) |
| 2 | **No public legal/info pages**: `/privacy-policy`, `/terms`, `/data-deletion`, `/help`, `/pricing`, `/changelog`, `/status`. Legacy `operator.*` and `site.public` settings have no rebuild key. | Meta app review needs a privacy URL; the data-deletion instruction page is the status URL in gap 1. | App owner + Root config |
| 3 | **Done at source (2026-10-22): error, alert and uptime writers.** Server/browser/worker errors feed `error_events`; shared Root monitoring writes incidents and sampled uptime through leased worker/web/manual execution. Email transitions use a persisted claim outbox. | Runtime/migration/mail verification and Telegram/provider-usage parity remain open. | Root owner |
| 4 | **Host backup scripts live only in the legacy tree** (`scripts/server/offsite-backup.sh`, `restore-test.sh`, `install-offsite.sh`, `hardening-20261009.sh`); they insert `backup_runs` rows that Root Backups reads. Installed to `/usr/local/sbin/ms-social-pilot-*` + `/etc/cron.d/ms-social-pilot-offsite`. | Deleting the root tree would orphan the source of the backup/restore-test record. | Release owner: move into `rebuild/scripts/server/` before cleanup |
| 5 | **Root `prisma/migrations/` is the only migration history** (134 dirs, rebuild ones included) and `prod-deploy.sh` runs `npm ci` at the repo root and tars `prisma/migrations`. `rebuild/package.json` uses `../node_modules/.bin/vitest` and `../.env`. | The "legacy" root cannot simply be deleted. | Release owner |
| 6 | **Done at source (2026-10-22):** rebuild `/api/health` checks database readiness; release local/public probes and rebuild recovery probe now use it. Legacy recovery probe is retained for the explicitly isolated legacy release. | Scripts syntax/source checked; actual release/recovery execution remains a release gate. | App owner |
| 7 | Missing customer features: workspace **Activity/Email history** (`settings/history`), **AI agents** (`settings/agents`), **caption tests**, **chart notes**, **key dates / seasons / holidays / trends**, **ICS calendar feeds**, **Slack/Telegram alert channels** (`chat_channels`), **spam check**, **engagement outlook**, **composer link-preview fetch**, **translated posts**, **AI image/video/voice**, **legacy REST `api_tokens`**. | Legacy capabilities not in LEGACY_CAPABILITY_PARITY.md (it has no rows for them). | Per module |
| 8 | Nine non-Facebook connectors and Instagram publishing. **Update 2026-10-22:** Instagram, YouTube and TikTok installed (fixture evidence); Mastodon, Threads, X, Bluesky, Telegram, LinkedIn, Pinterest staged adapters with Root settings, not customer-installable. | Partial | Platform owners |
| 9 | `import-legacy-config.ts` imports only Facebook, AI-provider, auth-policy and APP_URL values. Operator, alerts, retention, scheduler, media and link-shortener legacy settings are not imported. | Silent config loss if the legacy `app_settings` table is later dropped. | Root owner |
| 10 | Legacy `oauth_clients`/`oauth_codes` are not read; rebuild uses new `mcp_oauth_clients`/`mcp_oauth_codes`. Existing connector registrations must be re-created. | Connectors authorised under legacy stop working. | Integrations owner (document or migrate) |

**Update 2026-10-22 (history/public/errors lane; source + mocked tests only, no browser, PostgreSQL or production run):** gap 2 (public pages), gap 6 (`/api/health`) and the Settings › History and Root › Changelog parts of gap 7 are implemented in `src/modules/history/`; gap 3 is closed for server, browser and error-boundary errors via `src/server/errors/`. Operator follow-up below adds worker-side `recordError`, `system_alerts`/`uptime_days` writers and claimed email delivery. Telegram/provider usage parity remains open. The legacy `changelog_entries`, `activity_logs`, `email_logs` and `error_events` tables are the same tables the rebuild reads and writes, so no data import script is needed.

## 2. Pages (`src/app/**/page.tsx`)

Rebuild paths are relative to `rebuild/src/app/`.

| Legacy page | Rebuild equivalent | Status |
| --- | --- | --- |
| `(app)/accounts` | `settings/connections` | done |
| `(app)/ads` | `ads`, `ads/campaigns`, `ads/compare`, `ads/objects` | done (live management unproven) |
| `(app)/agency` | `agency`, `agency/clients` | done |
| `(app)/analytics` | `analytics` | done |
| `(app)/analytics/campaigns` | `analytics/reports` (Destinations/link details) | done (replaced): Destinations report link details; no standalone page |
| `(app)/analytics/links` | `reports` link details; click tracking `s/[slug]` | done (replaced): report link details and click tracking `s/[slug]` |
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
| `(app)/settings/agents` | none | done (`src/app/agents/page.tsx`, `modules/agents`) |
| `(app)/settings/api` | `settings/mcp` (+ person keys, v1 routes) | done (replaced): scoped keys at `settings/mcp`; legacy tokens are not honoured (item G2) |
| `(app)/settings/bio` | `settings/bio` | done |
| `(app)/settings/export` | `settings/data` | done: `settings/data`; coverage is disclosed in the UI |
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
| `(app)/welcome` | `home` onboarding + invitations (ONBOARDING.md) | done: Home onboarding and invitations (ONBOARDING.md) |
| `(auth)/login` | `sign-in` | done |
| `(auth)/login/two-step`, `two-step/setup` | `two-step`, `two-step/enroll` | done |
| `(auth)/register` | `sign-up` | done |
| `(auth)/forgot-password`, `reset-password` | `password-recovery` | done |
| `(auth)/verify-email` | `verify-email` | done |
| `(root)/root` | `root` | done |
| `root/activity` | `root/activity` | done |
| `root/agency` | `agency` module + `root/workspaces` | done: `agency` module, `root/workspaces`, client invitations (`modules/agency/server/client-invitations.ts`) |
| `root/alerts` | redirects to `root/operations` monitoring | One incident evaluator and Root screen; email plus explicitly selected owner-workspace Slack/Telegram subscriptions, with confirmed test UI/REST/MCP. Source and mocked evidence only. |
| `root/backups` | `root/backups` | done: reader `modules/root/server/admin/backups.ts`; writers `rebuild/scripts/server/{offsite-backup,restore-test}.sh` |
| `root/changelog` | `root/changelog` | done (source + mocked tests): `src/app/root/changelog/page.tsx`, `ui/ChangelogManager.tsx`, `server/changelog.ts`, `/api/root/changelog*`, Root MCP `list/add/remove_root_changelog_*` |
| `root/config`, `config/[section]` | `root/config`, `root/modules/[id]`, `root/platforms/[id]` | done |
| `root/connections` | `root/connections` | done |
| `root/danger` | `root/lifecycle` | done |
| `root/errors` | `root/errors`, `root/errors/[id]` | done for the recorder (2026-10-22): `src/server/errors/recorder.ts` (instrumentation `onRequestError`, browser reports, error boundary) now writes `error_events`; worker-side `recordError`, incident and uptime writers added by operator follow-up (2026-10-22); runtime evidence remains open |
| `root/meta`, `meta/connections` | `root/platforms/[id]` (Facebook), `root/connections` | done: `root/diagnostics` runs platform connectivity checks (replaces the app-check button) |
| `root/meta/usage` (Graph usage) | `api.meta.requestsPerMinute` key only | open (item G1): `graph_usage` has no reader or writer in the rebuild |
| `root/plans` | `root/plans` | done |
| `root/platforms`, `[platform]` | `root/platforms`, `[id]` | done |
| `root/privileges` | `root/privileges` | done |
| `root/registration` | `root/registration` | done |
| `root/sessions` | `root/sessions` | done |
| `root/status`, `root/worker` | `root/operations` (job health) | done: `root/operations` (job health, run history, monitoring) |
| `root/users` | `root/users` | done |
| `root/workspaces`, `[id]` | `root/workspaces` (+ `api/root/workspaces/[id]/access`) | done |
| `bio/[slug]` | `bio/[slug]/view` | done |
| `changelog`, `help`, `pricing`, `privacy-policy`, `status`, `terms`, `data-deletion` | same paths | done (source + render/route tests, 2026-10-22): `src/modules/history/ui/public-pages.tsx`, Root keys `public.siteEnabled/operator/content`; EN/FR; help/pricing/status/changelog gated by `public.siteEnabled`, legal pages always public; data-deletion keeps the confirmation-code lookup |
| `invite/[token]` | `join` | done |
| `page.tsx` (landing) | `page.tsx` | done |
| `settings/config` (owner config) | `root/config` | done |
| `setup` | none; owner via `scripts/admin/set-root.ts` / `prod-owner-reset-link.sh` | done (lane 44): `scripts/admin/set-root.ts`, `scripts/install-debian.sh`; there is deliberately no web setup |
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
| `api/ai-agents`, `[id]` | `api/agents`, `api/agents/scheduled` | done |
| `api/ai`, `ai/image`, `ai/video`, `ai/voice` | `api/ai` (text); `api/ai/media`, `api/ai/image`, `api/ai/video`, `api/ai/voice` → `modules/ai/content-tools/server/{media,http}.ts`; screen `/publishing/ai-studio` | done (2026-10-22: provider ports, Root policies `ai.imagePolicy`/`ai.voicePolicy`/`ai.videoPolicy`, exact confirmations, hourly/budget metering, library save; `tests/ai-media-generation.test.ts`, `tests/ai-media-ports.test.ts`; no live provider call; worker wiring of `pollAiVideos` open) |
| `api/analytics/[targetId]`, `analysis`, `export`, `pinned`, `post/[id]`, `refresh` | `api/analytics`, `explorer`, `comparison`, `demographics`, `pins`, `posts`, `report-workflows/*` | done |
| `api/api-tokens`, `[id]` | `api/settings/mcp-keys`, `account/person-keys`, `api/v1/*` | done (replaced; item G2) |
| `api/auth/login`, `logout`, `register`, `verify-email` | `api/auth/sign-in`, `sign-out`, `register`, `verify-email(/resend)` | done |
| `api/auth/passkeys/*` | `api/auth/passkey/*`, `api/settings/account/passkeys` | done |
| `api/auth/password-reset`, `confirm` | `api/auth/recovery/request`, `reset` | done |
| `api/auth/two-step/*` | `api/auth/two-step/*`, `api/settings/account/security/*` | done (trusted devices are listed and revoked through `settings/account/security`) |
| `api/bio` | `api/sharing/bio` | done |
| `api/calendar-feed/[token]`, `calendar-feeds`, `[id]` | same paths | done at source (token ICS, revocable; parity exception row for the bearer read; no real calendar-client run) |
| `api/caption-tests/[id]/learn` | `api/caption-tests/[id]/learn` → `modules/caption-tests/server/service.ts` `learnCaptionTest`; MCP `learn_from_caption_test` | done (2026-10-22: appends the winner to the workspace voice, not per-channel voice; `tests/caption-tests-service.test.ts`) |
| `api/chart-notes`, `[id]` | `api/chart-notes`, `[id]` | done |
| `api/chat-channels`, `[id]`, `[id]/test` | `modules/notifications/chat-channels` UI/REST/MCP service; transactional event outbox drained by leased notifications worker | Implemented at source in lane 43 for subscribed publication, inbox and operator events; migration and real chat delivery unverified. |
| `api/connections/ads/[id]`, `instagram/[id]` | `api/settings/connections` | done |
| `api/content-mix` | `api/publishing/content-mix` | done |
| `api/cron/tick` | worker `scripts/worker.ts` | obsolete: external cron trigger replaced by worker |
| `api/custom-fields`, `[id]` | `api/publishing/custom-fields/*` | done |
| `api/engagement/comments`, `messages`, `sync`; `api/inbox`, `assign`, `notes*` | `api/inbox/*` | done |
| `api/errors` | `api/errors` | done (source + mocked tests): `src/app/api/errors/route.ts`, `src/server/errors/client-report.ts`; Root-bounded rate limit and size; parity exception recorded in MCP_PARITY.md |
| `api/exports`, `[id]` | `api/settings/data/exports`, `snapshot` | done |
| `api/facebook/connect`, `callback` | `api/connections/[platform]/start`, `callback` (+ `api/oauth/connections/[platform]/start`) | done; Meta redirect URI must be updated to the new callback |
| `api/facebook/data-deletion`, `deauthorize` | `api/platforms/[platform]/{deauthorize,data-deletion}` | done at source (gap 1) |
| `api/feeds`, `[id]` | `api/feeds/*` (+ WordPress) | done |
| `api/health` | `api/health` | done at source: health route + service; `prod-deploy.sh` local/public readiness and rebuild rollback drill now probe `/api/health` (2026-10-22). Scripts syntax/source tested, never executed against production by this lane |
| `api/instagram` | `platforms/instagram/**` | done (installed, publishing included; fixture evidence) |
| `api/key-dates`, `seasons` (+ `[id]`) | `api/key-dates`, `api/seasons` (+ `[id]`), `api/chart-notes`, `api/calendar/trends` | done at source; MCP_PARITY rows `*_calendar_*` |
| `api/labels`, `[id]` | `api/publishing/labels/*` | done |
| `api/link-preview` | `api/publishing/link-preview` → `modules/ai/content-tools/server/checks.ts` `linkPreview`; MCP `get_link_preview` | done (2026-10-22: neutral SSRF-guarded HTML fetch under Root `ai.linkPreviewPolicy`; the legacy Facebook re-scrape `refresh` option is not carried: it belongs to a Facebook-module hook; `tests/ai-composer-checks.test.ts`) |
| `api/mcp` | `api/mcp` | done |
| `api/media`, `[id]`, `[id]/raw`, `import` | `api/media`, `api/media-library/*` | done |
| `api/moderation/rules*`, `actions/[id]/undo` | `api/inbox/moderation` | done |
| `api/networks/[network]/connect|callback`, `bluesky`, `telegram` | staged adapters; generic `api/platforms/[platform]` OAuth routes | open for Bluesky/Telegram credential flows (item G3) |
| `api/notifications` | `api/notifications` | done |
| `api/oauth/authorize`, `register`, `token` | same | done |
| `api/page-goals` | `api/analytics/goals` | done |
| `api/page-groups`, `[id]` | `api/settings/profiles` | done |
| `api/post-notes/[id]`, `posts/[id]/notes` | `api/publishing/notes/*` | done |
| `api/post-templates*`, `snippets*` | `api/publishing/templates/*` | done (snippets are folded into templates) |
| `api/posts`, `[id]`, `approve`, `publish`, `retry`, `remove`, `purge`, `undo-send` | `api/publishing/posts/*`, `[id]/[action]`, `[id]/deletion`, `recovery` | done |
| `api/posts/[id]/duplicate`, `first-comment`, `recycle`, `versions`; `actions`, `bulk`, `export` | `api/publishing/duplicate`, `first-comments/*`, `recycle`, `versions`, `posts/bulk`, `export` | done |
| `api/posts/outlook`, `spam-check` | `api/publishing/outlook`, `api/publishing/spam-check` → `modules/ai/content-tools/server/checks.ts`; MCP `get_engagement_outlook`, `check_post_spam_risk` | done (2026-10-22: outlook reads platform-module `postPerformance`; spam uses workspace `spamGapMinutes`; both inside channel grants; composer embed pending, screen at `/publishing/ai-studio`; `tests/ai-composer-checks.test.ts`) |
| `api/queue`, `queue-slots` | `api/publishing/queue`, `queue-slots` | done |
| `api/report-schedules*`, `report-templates*`, `reports` | `api/analytics/report-workflows/*`, `api/reports/export` | done |
| `api/root/alerts/test` | alias of `api/root/monitoring/test`, `test_root_monitoring`, `testRootOperatorMonitoring` | One Root monitor, exact TEST ROOT MONITORING and audited durable test intent; real email/chat delivery unverified. |
| `api/root/app-check` | `api/root/diagnostics` | done |
| `api/root/changelog*` | `api/root/changelog`, `api/root/changelog/[id]` | done (source + mocked tests): exact confirmations, Root actor recheck and transactional audit |
| `api/root/client-invitations*` | `/api/root/client-invitations` (`modules/agency/server/client-invitations-http.ts`) | done |
| `api/root/config*`, `adopt`, `ai-models`, `test-email` | `api/root/config`, `diagnostics` | done (adopt obsolete: `import-legacy-config.ts`) |
| `api/root/connections/health` | `api/root/connections*` | done |
| `api/root/errors/[id]` | `api/root/errors*` | done |
| `api/root/invitations`, `members`, `subscribers`, `plans`, `privileges`, `sessions`, `users*`, `workspaces*`, `visit`, `transfer` | `api/root/registration*`, `plans*`, `privileges*`, `sessions*`, `users*`, `workspaces*`, `lifecycle*`, `installation` | done |
| `api/saved-replies*`, `saved-views*` | `api/inbox/productivity`, `api/publishing/saved-views*` | done |
| `api/settings/config*` | `api/root/config` | done |
| `api/setup` | scripts | done (see `setup`) |
| `api/share-links*`, `share/[token]` | `api/sharing/*`, `share/[token]` | done |
| `api/structured-data` | `modules/publishing/server/link-tools/{service,structured-data,mcp}.ts` | done |
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
| `facebook/publish`, `graph`, `oauth`, `permissions`, `insights`, `edges`, `metrics`, `ads`, `analytics`, `budget*`, `call-source`, `opengraph` | `platforms/facebook/**` | done (opengraph preview: `modules/ai/content-tools/server/checks.ts`); Group publishing dropped: Meta removed the Groups API 2024-04-22 |
| `facebook/instagram*`, `instagram` | `platforms/instagram/**` (discovery, analytics, inbox, publishing, first comment) | done (installed, disabled by default; fixture evidence) |
| `networks/youtube`, `networks/tiktok`, YouTube/TikTok branches of `networks/connect` and `network-rules` | `platforms/youtube/**`, `platforms/tiktok/**`, shared `server/platforms/{token-connection,token-renewal-job,provider-http,request-locale}.ts` | done at fixture level (stubbed `fetch`; no live Google/TikTok run). Not carried over: YouTube/TikTok public-counter `stats` (no analytics host), YouTube `remove` is done, TikTok has no delete API |
| `networks/{bluesky,mastodon,linkedin,threads,x,pinterest,telegram}` (7 connectors) | `platforms/{bluesky,mastodon,linkedin,threads,x,pinterest,telegram}/**` staged adapters | open (item G3): not customer-installable |
| `inbox`, `inbox-notes`, `inbox-response`, `moderation*`, `reply-template`, `response-time`, `negative-comments`, `mentions` | `modules/inbox/**`, `modules/ai/server/sentiment.ts` | done |
| `analytics*`, `audience*`, `aggregate`, `channel-figures*`, `page-analysis*`, `network-analytics`, `network-rules`, `pinned-metrics`, `page-goals`, `goals`, `label-report`, `link-analytics`, `reports`, `report-*`, `analytics-export`, `ads-analysis` | `modules/analytics/**`, `modules/ads/**` | done |
| `engagement-prediction`, `engagement-outlook` | `modules/ai/content-tools/pure.ts` `predictEngagement`, `server/checks.ts` | done (2026-10-22) |
| `caption-test` | `modules/caption-tests/{pure.ts,server/service.ts}` | done (2026-10-22; lane 43 adds raw variants through atomic Publishing draft creation; tests also accept existing posts) |
| `engagement` | Inbox sync (`src/platforms/facebook/inbox.ts`, `modules/inbox`) | done |
| `chart-notes`, `chart-note-colors` | `modules/calendar-extras` (notes service, `/analytics/notes`, chart marks) | done at source |
| `key-dates*`, `seasons`, `holidays`, `trends` | `modules/calendar-extras` (+ queue allocator season hook in `executors.ts`) | done at source |
| `ics`, `calendar-feeds`, `calendar-days` | `modules/calendar-extras/server/{ics,subscriptions}.ts`, `lib/calendar-dates.ts` | done at source |
| `spam-guard` | `modules/ai/content-tools/pure.ts` `assessSpamRisk`, `server/checks.ts` `spamCheck` | done (2026-10-22) |
| `chart-notes`, `chart-note-colors` | `modules/calendar-extras` (notes service, `/analytics/notes`, chart marks in Analytics overview and Explorer) | done at source |
| `ai`, `ai-providers`, `ai-models`, `ai-prices`, `ai-agents` | `modules/ai/**` incl. prices and budget (`usage.ts`) and agents (`modules/agents`) | done |
| `ai-image`, `ai-video`, `ai-voice`, `voice-names` | `modules/ai/content-tools/server/{media,media-openai,media-gemini,media-ports}.ts`; voice names are the Root `ai.voicePolicy.voices` list | done (2026-10-22) |
| `text-backgrounds`, `alt-text`, `translation`, `translated-posts` | `modules/ai` translate kind only | translation and translated-posts done (`modules/ai/server/translated`); `text-backgrounds` and `alt-text` open (items G4, G5) |
| `chat` | `modules/notifications/chat-channels/server/{service,delivery,transport}.ts` | Source/UI/REST/MCP plus leased, idempotent event delivery. Uncertain sends are held; real transport outcomes remain unverified. |
| `system-alerts`, `error-tracking`, `uptime`, `health`, `housekeeping`, `background-refresh` | `modules/root/server/operator-monitoring.ts`, shared runner, error recorder; alerts + sampled uptime + worker errors implemented | done at source for writers and health probes (2026-10-22); Telegram/provider-usage parity and live evidence remain |
| `media`, `image-format`, `image-variants`, `media-links`, `zip`, `workspace-export` | `modules/media/**`, `server/data-control/**`, `modules/settings/server/exports.ts` | done |
| `bio`, `share-links`, `agency*`, `tasks`, `task-workflow`, `team`, `role-access`, `scope-abilities`, `page-access`, `page-groups`, `page-filter`, `selection`, `custom-fields`, `feeds`, `rss/*`, `webhooks`, `api`, `public-api`, `api-tokens` | corresponding modules; `api-tokens` replaced by MCP/person keys | done |
| `root*`, `operator`, `site`, `setup`, `meta-app`, `plans`, `settings/*`, `config-draft`, `modules`, `env` | `server/root/**`, `server/config/**`, `lib/config/**`, `modules/history` (`public.operator`), `scripts/admin/*` | done |
| `activity`, `history` | writers in many modules; reader `modules/history/server/history.ts` | done (reader added 2026-10-22; retention follows `root.auditRetentionDays` for activity only) |
| `scheduler/*` | `server/jobs/**`, `scripts/worker.ts` | done |
| `structured-data*`, `safe-fetch`, `holidays` data, `world-map.json`, `palette`, `themes`, `brand`, `languages`, `time`, `text`, `csv`, `json`, `paging`, `validation` | `lib/themes.ts`, per-module helpers, `link-tools/structured-data.ts`, `net-guard.ts`; world map has no consumer | done |

## 5. Prisma models (legacy `prisma/schema.prisma`)

"Rebuild use" is raw SQL or the rebuild Prisma client (`rebuild/prisma/schema.prisma` maps 31 models). Table references found by grep of `FROM/JOIN/INTO/UPDATE` in `rebuild/src`.

| Models | Rebuild use | Status |
| --- | --- | --- |
| User, Session, Workspace, Membership, Passkey, RecoveryCode, McpApiKey, SocialAccount, Target, Post, PostTarget, PostComment, Conversation, ConversationMessage, PageInsight, InstagramAccount/Media/Insight, AdAccount, AdInsight, AppSetting, WorkspaceDataPurge, SavedView | Prisma client | done |
| EmailToken, Invitation, PostVersion, InboxNote, BioPage, BioLink, Task, CustomField, PostFieldValue, PostNote, PageGoal, QueueSlot, PageGroup, PageGroupTarget, MemberPageAccess, Label, PostLabel, FeedSource, FeedItem, ShortLink, LinkClick, NotificationSetting, NotificationMute, EmailLog, PageReview, ExternalPost, Media, ActivityLog, PostTemplate, SavedReply, ShareLink, ReviewDecision, ReportTemplate, ReportSchedule, WebhookEndpoint, WebhookDelivery, RootActivity, TrustedDevice, ModerationRule, ModerationAction, ContentMixRule, Plan, WorkerHeartbeat | raw SQL | done |
| BackupRun, SystemAlert, ErrorEvent | read and written (`rebuild/scripts/server`, `src/server/errors`, Root monitoring) | done |
| MetricAvailability, PageVideo | export/purge; provider adapters own availability, no product reader needed | done |
| WorkspaceExport | replaced by `rebuild_workspace_exports`; old rows obsolete | obsolete: new async ZIP service |
| OAuthClient, OAuthCode | replaced by `mcp_oauth_clients/codes` | obsolete: not migrated (gap 10) |
| RebuildReportRun (`report_runs`) | `modules/analytics/reports` | done |
| AiAgent, AiGeneration, CalendarFeed, ChartNote, ChatChannel, ClientInvitation, ApiToken, Snippet, UptimeDay, PublicHoliday, HolidayYear, TrendingTopic, KeyDate, SeasonalMode, ChangelogEntry, WorkerJobRun, GraphUsage | used by agents, ai usage, calendar-extras, chat-channels, agency invitations, history; `ApiToken`, `Snippet`, `GraphUsage` unreferenced (items G1, G2); keep the tables | done except G1/G2 |

## 6. Root settings and env

Legacy `app_settings` keys (`src/lib/settings/definitions.ts`) vs rebuild registry.

| Legacy key(s) | Rebuild key | Status |
| --- | --- | --- |
| `app.url` | `app.publicOrigin` (+ `mail.publicOrigin`) | done |
| `auth.openRegistration`, `auth.loginAttempts`, `auth.loginWindowMinutes`, `security.twoStep` | same keys | done |
| `limits.workspaceRequestsPerMinute` | `security.apiRequestsPerMinute` (UI/REST) and `mcp.requestsPerMinute` (MCP), section 0.4 | done (mapping) |
| `i18n.defaultLocale` | `ui.defaultLocale` (lane 44, schema 133) | done |
| `cron.secret` | none | obsolete: `api/cron/tick` removed |
| `operator.*` (10 keys), `site.public` | `public.operator`, `public.siteEnabled`, `public.content` | done |
| `facebook.appId/appSecret/graphVersion/graphBaseUrl/scopes/requestTimeoutSeconds` | `meta.appId/appSecret/graphVersion/graphBaseUrl/oauthScopes/requestTimeoutMs` | done (imported) |
| `facebook.uploadTimeoutSeconds` | `facebook.native.*` timeouts, section 0.4 | done (mapping) |
| `features.groups/messaging/instagram/ads` | `ads.managementEnabled`, module/platform enablement | done (groups dropped: Meta API removed) |
| `scheduler.pollSeconds/concurrency/maxAttempts/staleLockMinutes` | `jobs.*`, per-job schedule keys, `notifications.maxAttempts`, worker lease keys, section 0.4 | done (mapping) |
| `scheduler.rssPollMinutes`, `evergreenCheckMinutes`, `nativeReconcileMinutes`, `tokenExpiryCheckHours`, `bulkRowLimit` | `feeds.autoCheck.*`, `publishing.automation.*`, `notifications.connectionWarningDays`, `publishing.maxImportRows` | done |
| `analytics.refreshHours/pageInsightsHours/edgeSyncHours/instagramSyncHours/adsSyncHours/postBatch/commentPostLimit/videoLimit/edgeWindowDays/adWindowDays/tokenWarningDays` | `meta.postHistoryPolicy`, `meta.pageInsightMetrics`, per-job schedule keys, `data.insightDefaultDays`, `inbox.sync*`, `notifications.connectionWarningDays`, section 0.4 | done (mapping) |
| `tiktok.*`, `youtube.*` | `platforms.tiktok.*`, `tiktok.policy`, `tiktok.clientKey`, `tiktok.clientSecret`, `platforms.youtube.*`, `youtube.policy`, `youtube.clientId`, `youtube.clientSecret` | done at fixture level (legacy client id/secret settings need importing from the legacy `app_settings`; `import-legacy-config.ts` unchanged) |
| `networks.*`, `linkedin.*`, `threads.*`, `x.*`, `pinterest.*` | module-owned settings via PLATFORM_CONFIG | staged, not customer-usable (item G3) |
| `ai.provider/apiKey/model/openaiKey/geminiKey` | `ai.provider`, `ai.apiKey`, `ai.model`, `ai.openaiApiKey`, `ai.geminiApiKey` (+ models/endpoints) | done (imported) |
| `ai.rateLimitPerHour` | `ai.hourlyRequestsPerWorkspace` | done |
| `ai.monthlyBudgetUsd`, `ai.priceOverrides` | `ai.monthlyBudgetUsd`, `ai.priceOverrides`, `ai.fallbackInputPricePerMillionUsd`, `ai.fallbackOutputPricePerMillionUsd`, `ai.charactersPerToken` | done in source (mocked tests; estimated tokens, not provider-reported; no live run) |
| `alerts.email/telegramBotToken/telegramChatId/publishFailures/diskPercent` | `root.monitoringPolicy`, `root.monitoringMailCopy`, `notifications.chatPolicy` and encrypted workspace chat destinations | One Root monitor supplies email and selected workspace chat subscriptions; publish/disk thresholds are Root-owned. Old duplicate notifications.systemAlert* keys removed in lane 43. Legacy settings are not automatically migrated by this lane. |
| `email.provider/smtp*/apiKey/from` | `mail.*` (SMTP); the HTTP API provider is not carried (item G6) | open |
| `links.shortenerDomain` | `publishing.shortLinkBaseUrl` | done |
| `retention.activityDays/emailDays/clickDays/aiDays/sweepHours` | `retention.auditDays/emailDays/clickDays/aiDays/errorDays/schedule`, `root.auditRetention*`, section 0.4 | done (mapping) |
| `media.dir`, `media.workspaceQuotaMb`, `media.maxUploadMb`, `media.retainUnusedDays` | `storage.mediaRoot`, `media.workspaceQuotaBytes`, `publishing.maxImageUploadBytes`, `media.videoMaxBytes` | open: `retainUnusedDays` (item G7) |

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

## Operator follow-up (2026-10-22; source and mocked tests)

Alert evaluation and `uptime_days` writing are implemented through the private
Root monitoring service; UI, REST and MCP delegate to the same Root-authorized,
exactly confirmed evaluation. Dedicated worker and independent web observer use
the same leased job runner and run history; web observers never write worker
heartbeats or run publishing jobs. Minute claims prevent repeated observations
from inflating daily totals. Incidents enqueue email only on state transitions;
committed delivery claims preserve uncertain sends without automatic replay.
Worker job/tick/startup errors use the existing scrubbed `recordError` service.
Release and recovery scripts use the rebuild database-backed health probe.

This closes the requested evaluation/writer/health-probe source gaps, not all
legacy alert delivery parity: Telegram, provider-specific usage alerts and the
standalone legacy test-alert endpoint remain open. No migrations, browser,
mail delivery, production scripts or deployment were executed by this lane.

## Lane 43 reconciliation — 2026-10-22

The historical missing rows above retain their original baseline. Current source
adds raw-caption test creation through Publishing, transactional chat-event
production and one Root operator-monitoring system with email/chat delivery and
a confirmed test operation. See [LANE_43_FOLLOWUPS.md](LANE_43_FOLLOWUPS.md) for
verification and remaining gates. Chat tests now run under `rebuild/tests`.
`rebuild_chat_deliveries` is a new workspace-owned outbox; apply and rehearse its
repository-root migration before worker delivery. No data migration, live
transport, provider, browser or production outcome is asserted. Provider usage
alerts and unrelated legacy capabilities remain separate open work. Facebook
Groups remain dropped by the owner's decision.
