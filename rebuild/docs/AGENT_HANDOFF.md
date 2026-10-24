# Shared agent handoff

Updated 2026-10-24: batch 18 (`dc82625b`) deployed live (`DEPLOY OK
dc82625b`), schema **142**. Full goal remains active. Historical records
below retain their dates; current source reconciliation wins.

## UI/UX audit — 2026-10-24 (Batches 1, 2 & 3 + Phone/Root polish implemented, pushed)

[UX_AUDIT_2026-10-24.md](UX_AUDIT_2026-10-24.md) lists the screenshot audit of
37 routes at 1440/390 on the synthetic preview. Batch 1 (quick fixes, items
1–6), Batch 2 (consistency, items 7–12), Phone (390px) tap-target fixes, Ads ›
Analysis structured list, and Batch 3 + Root sidebar polish are implemented,
typechecked (`npm run typecheck` 0 errors), and verified across Vitest suites
(including `tests/ux-audit-batches-1-2.test.ts`):

- **Batch 1 (items 1–6)**:
  - **Sidebar channel names & scope highlight** (`src/styles/shell.css`,
    `ChannelScopeList.tsx`, `AppShell.tsx`): constrained `.shell-sidebar__scroll`,
    `.ui-scope`, `.ui-scope__list`, `.ui-scope__row`, and `.ui-scope__item` with
    `minmax(0, 1fr)` / `min-width: 0` / `overflow: hidden` so long channel names
    truncate with an ellipsis, and gated "All channels" `.is-selected` on
    `scopeActive` (true only on channel-scoped areas).
  - **Approvals board at 1440px** (`publishing/ui/approvals/approvals.module.css`):
    responsive `repeat(auto-fit, minmax(min(100%, 260px), 1fr))` grid with a
    2-column breakpoint at `1400px`.
  - **Tasks & Agency tabs** (`AppShell.tsx`): `effectiveOptionalAreas` always
    includes the active optional area (`tasks` or `agency`) so its tab is
    rendered and selected even when `optionalAreas` omits it.
  - **AI Studio tabs** (`AiStudioScreen.tsx`, `AiStudioPage.tsx`): disabled
    tools are hidden from the tab bar, stale `?tab=` parameters redirect to the
    first enabled tool, and the unavailable empty state renders only when all
    four tools are disabled.
  - **Plurals (EN & FR)** (`agency/ui/copy.ts`, `AgencyScreen.tsx`,
    `publishing/ui/content-copy.ts`, `ApprovalPipeline.tsx`, `CalendarBoard.tsx`,
    `ads/copy.ts`, `ObjectsScreen.tsx`): singular/plural keys for Agency status
    counts (`1 channel cannot publish`, `1 failed post`, `1 overdue task`),
    Publishing counts (`1 post`), and Ads Manage results (`1 result` / `results ·`).
  - **Locale formatting in Ads** (`TrendChart.tsx`, `ObjectsScreen.tsx`,
    `ads/ui/compare/CompareScreen.tsx`, `ObjectPerformance.tsx`): currency codes
    formatted via `Intl.NumberFormat`, ISO `YYYY-MM-DD` dates formatted via
    `Intl.DateTimeFormat`, and single-day bar chart categories formatted via
    `dateFormatters(...).axis`.
- **Batch 2 (items 7–12)**:
  - **Unified period picker & Compare defaults** (`insights-config.ts`,
    `InsightsFilterRow.tsx`, `DemographicsScreen.tsx`, `explorer-posts/Screen.tsx`,
    `analytics/ui/compare/CompareScreen.tsx`, `ComparisonFilters.tsx`): added
    `365` to `analytics.insightsPolicy.rangePresets`, standardized Audience,
    Posts, and Compare onto `DateRangePicker`, and defaulted `/insights/compare`
    to the 28-day policy window vs the preceding 28-day window.
  - **Live search & compact Inbox saved views** (`MediaLibrary.tsx`,
    `ManageSearchFilter.tsx`, `ObjectsScreen.tsx`, `InboxFilterRow.tsx`,
    `InboxSavedViews.tsx`, `InboxScreen.tsx`, `inbox.module.css`): live search
    without Apply buttons in Library, Ads Manage, and Inbox; saved views moved
    into a `Views ▾` popover menu on the filter toolbar; default `kind=message`
    excluded from active filter chips on initial load.
  - **Single primary button per view** (`settings/ui/connections/row-menu.tsx`,
    `TaskBoard.tsx`): account-card `Reconnect` changed to `variant="secondary"`
    and duplicate toolbar `New task` hidden when the unfiltered empty state renders.
  - **Shared select & disclosure styling** (`AddressSelect.tsx`,
    `explorer-posts/Screen.tsx`, `settings/ui/workspace/cards.module.css`):
    `.ui-input` styling on Insights Posts sort selects and shared chevron/hover
    styling on the Workspace UTM `<details>` disclosure.
  - **Disclaimers behind `ⓘ`** (`CsvExportButton.tsx`, `CampaignsScreen.tsx`,
    `CampaignCharts.tsx`, `ConnectionsScreen.tsx`, `settings/ui/_components.tsx`):
    export notes, per-account campaign notes, and the Channels footer note moved
    into `InfoTip` (`ⓘ`) triggers.
  - **Agency KPI tiles & `--mod-agency` token** (`src/styles/tokens.css`,
    `agency.module.css`): widened `.metrics` tiles to `minmax(240px, 1fr)`,
    kept `.actions` on a single row on desktop, and updated `--mod-agency` across
    all themes from pink to brand-blue/indigo shades (`#185FA5` / `#85B7EB` /
    `#534AB7` / `#378ADD`).
- **Phone (390px) & Batch 3 + Root Polish**:
  - **Phone & coarse-pointer tap targets + Root sidebar** (`responsive.css`,
    `shell.css`, `root-nav.css`, `root-directory.css`, `inbox.module.css`):
    `44px` minimum tap targets on coarse/phone viewports for `InfoTip` (`ⓘ`),
    sidebar "Show more / Manage channels", inline `.text-link`, Root sidebar
    items and directory pagers, and Inbox quick chips/pagers; harmonized
    `.root-directory-nav` with `--rail-*` sidebar tokens.
  - **Ads › Analysis structured fields** (`analytics/ad-objects/Screen.tsx`,
    `screen.module.css`): replaced raw JSON `<pre>` with a semantic `<dl>` using
    `storedFieldRows(...)`, localized currency formatting, and `.ui-input`
    filter controls.
  - **Composer, Approvals & Calendar** (`PostComposer.tsx`,
    `approvals.module.css`, `calendar.module.css`): moved **Media** immediately
    after **Post text** and rendered a visible helper line for blocked channels
    in Composer; removed duplicate author header and aligned actions side-by-side
    in Approvals cards; brand accent "today" badge and hover/focus `+ New post`
    reveal in Calendar.
  - **Insights & Settings › Workspace** (`AudienceCharts.tsx`, `PostsTable.tsx`,
    `explorer-posts/Screen.tsx`, `WorkspaceCards.tsx`, `cards.module.css`):
    human-readable audience labels (`formatAudienceLabel`) for demographic,
    country, and locale codes; sortable column headers (`aria-sort`) on
    `PostsTable`; formatted `00:00`…`24:00` hour `<Select>` controls for
    Workspace working hours and full-width `.cards` alignment.
- **Next**: rerun `scripts/dev/ui-audit.mjs` against the preview server and
  deploy when in an authorized live lane.

## Batch 18 — 2026-10-24 (deployed, browser-verified)

User request: "improve UI with graphs". Audit found the overview,
campaigns, compare, explore and audience screens already chart with
real data; the genuine gaps were Ads accounts (no charts) and Ads
analysis (sparklines only):

- **Accounts hero** (`AccountsTrendCharts`): one stacked spend panel
  per currency plus a shared impressions panel, top 12 accounts by
  spend with an explicit capped note. Zero new queries (summaries
  already loaded).
- **Analysis hero** (`ObjectsTrendCharts`): same pattern over the
  filtered selection; service aggregates `accountDaily` pre-paging so
  the hero never disagrees with the table.
- **Shared `TrendChart`**: lines for several days, grouped bars for a
  single stored day (no more lone dots); `CampaignCharts` refactored
  onto it.
- New copy: ads `text273-276` (EN+FR, narrow-nbsp typography),
  records "Selection trend / Daily spend / Daily impressions".
- Evidence: root suite 779 files / 12313 passed / 0 failed, ad-objects
  suite 29/29, typecheck clean; preview screenshots of both heroes
  verified (per-currency panels, bar-vs-line switch, legend).

## Batch 17 — 2026-10-24 (deployed, proven at production scale)

User report: "insights/audience don't work, ads graphs not well
displayed". Root causes found by reproducing with real-data volumes:

- **Audience**: default 30-day window holds 992 snapshots / 10,361+
  items vs the 5000 `analytics.reportExportRows` limit, and
  `readDemographics` refused outright → "History could not be loaded".
  Now trims oldest-first (each metric keeps its latest), marks with a
  shown/total notice (EN+FR, stale-catalog fallback) and a
  `truncated,true` CSV marker row; refuses only undisplayable history.
  MCP result-budget refusal unchanged.
- **Charts**: `ChartCanvas` mounts lazily on visibility (history views
  mount 100+ charts inside closed disclosures).
- **Ads**: `.metric-grid` is container-responsive (side-panel KPIs no
  longer overlap at 4-across), cards clip sparklines, CTR uses 2
  decimals like the table, funnel labels move outside narrow segments,
  single-day spend renders a bar instead of a lone dot.
- Evidence: full suite 12309 passed / 0 failed; preview end-to-end at
  prod scale (121 snapshots → notice "latest 109 of 121", 0 JS errors,
  CSV marker present, temp rows removed); prod SQL lower bound 10,361
  items proves the old code threw here.

## Weakness-hunt batches 6-11 — 2026-10-23 (pushed, sandbox lane)

Six batches, each typechecked, unit-tested and pushed to `origin/main`
(full suite green after batch 8: 779 files, 12296 tests, 0 failures).
Deploy, browser matrix, screenshots and all live gates still need a
`--yolo` relaunch (sandbox blocks SSH/Docker).

- **Batch 6** (`5dd45cae`): approvals board draft/approved totals exact
  over the full authorized scope (`readDraftApprovalSplit`; the
  raw-SQL-only `approvalStatus` column forces a scope translation, same
  rules as `publishingPostReadQuery`). Fail-soft to page-1 math.
- **Batch 7** (`72730698`): analytics post explorer rows link to the
  internal post page via one batched `post_targets` lookup
  (`resolveInternalPostIds`); unmapped rows unchanged.
- **Batch 8** (`1e46216e`): dry-run boundary audit found worker email
  sends escaping `jobs.stagingDryRun`; now suppressed and audited as
  `email_notification`, rows left pending. All other worker dispatch
  paths verified guarded or local-only.
- **Batch 9** (`061ba36b`): creatives browser shows fetched title/body
  and gains a Copy ID row action (shared ads copy keys).
- **Batch 10** (`707708ae`): inbox comment rows link the origin post
  (`postId` added to the list read, no new query; sibling link outside
  the thread anchor; row separator moved to the list item).
- **Batch 11** (`2f20e94d`): the new post links match the unconditional
  cross-link convention (thread head, tasks, media, approvals, calendar,
  home); also fixes the progressive inbox rows never getting the link.
- Hunted and verified healthy (no change): tasks, media, reports
  manager/history, agency clients/invitations, settings connections,
  studio agents, home dashboard, calendar, approvals cards, inbox
  cursors/empty states/freshness, thread-head post link. Report-history
  re-download deliberately not built (idempotent re-prepare replays
  stored output; history rows are records).

## UI waves 3-4 — 2026-10-23 (source/unit only, uncommitted)

All work is in the working tree, no commit/push/deploy. `npm run typecheck`
0 errors; new `tests/ui-waves-3-4.test.ts` (10) passes plus the
`inbox-sync-freshness` mock fix (Badge mock added, feature-required) and a
149-file area sweep (1427 passed, 14 skipped). No `lint.mjs` in this tree
(the handoff-referenced script is absent; no lint gate was runnable).

- **Kind at a glance** (`inbox/ui/InboxTags.tsx` `inboxKindTone` + `brand`
  tone, `InboxListRows.tsx`, `InboxScreen.tsx`): message badges accent,
  comment/review neutral, in rows, kind tabs and thread head; lane edges
  and icon+labels unchanged. Thread head gains the contact `PersonAvatar`
  (`inbox.module.css` grid).
- **Freshness/views/search** (`InboxActions.tsx` `inboxFreshnessState`,
  `inbox-round3.module.css`, `InboxFilterRow.tsx`): stale reads show a
  warning badge beside Sync now; saved views are chips with the open view
  tinted; search sits in a `search` landmark. Freshness still stored-reads
  only; a completed sync clears the badge.
- **Moderation + notifications** (`ModerationRules.tsx`
  `moderationOutcomeTone`, `NotificationCenter.tsx`
  `notificationEventTone`, `notifications.module.css`): Paused/action and
  log-outcome badges with shared empty states; state/event-kind badge
  split keeping the same words (existing combined-text test still passes
  via an aria-hidden separator), unread titles bold with an accent dot,
  unread count in a solid badge.
- **Insights** (`OverviewCards.tsx` `activityOutcomeTone`, `insights.css`):
  equal-height KPI tiles, underline chart-metric switch, ranked Top posts,
  planned-vs-published activity chips. No catalog change: zero new user
  strings anywhere (strict `insightsCopy` untouched, no merge needed).
- **Ads manage** (`objects/status-tone.ts` new, `ObjectsScreen.tsx`):
  stored status in a tone Badge via a neutral case-insensitive matcher;
  raw stored text still shows. Covers Campaigns/Ad sets/Ads tabs.
- **Studio** (`agents/ui/status-tone.ts` new, `AgentsScreen.tsx`,
  `ScheduledAgents.tsx`): shared empty states, run-outcome and
  active/paused badges. AI studio and caption tests already used the
  shared patterns; untouched.
- **Unresolved / next:** BEFORE/AFTER screenshots and `inspect.mjs`
  blocked (no local Postgres, no Playwright browsers, no `DATABASE_URL`;
  BEFORE is source at `92b2fb05`). Next: browser matrix at 1440/768/390
  light+dark, keyboard walkthrough, tabular-figure check.

## UI wave 2 — 2026-10-23 (source/unit only, uncommitted)

All work is in the working tree, no commit/push/deploy. `npm run typecheck`
0 errors; 6 new suites (24 tests) pass plus 23 neighbor files (282) and a
118-file area sweep (1155); `lint.mjs --app` 0 FAIL on all 18 touched
sources (quiet-hour hatch carries `taste-skill-ignore` as functional
calendar marks; clock padding and pre-existing shadows defended).

- **Composer tabs** (`compose/ChannelPreviewTabs.tsx`, `PostComposer.tsx`,
  `PostPreview.tsx` + CSS, `PostAttachments.tsx` tile layout): All channels
  + one shared-`Tabs` tab per destination, rendering the module's safe
  format metadata (fold, shape, caption, first-comment slot) with an
  "approximate" line; deselecting returns to All. New neutral descriptor
  `preview` hints (`platforms/types.ts`, validated in
  `publishing/formats.ts`); Facebook (480-char feed fold, story shapes)
  and Instagram (125-char fold, story/reel shapes) declare values,
  YouTube/TikTok stay neutral.
- **Calendar** (`CalendarScreen/Toolbar/Board.tsx` + CSS, `types.ts`,
  `studio/agents/quiet-hours.ts`): additive `view=list` week list; week
  Timeline | By channel swimlanes (sticky lane column, multi-channel posts
  in each lane); quiet-hour hatch + legend and Move-dialog quiet/cap
  warnings from the resolved autopilot policy (advisory only, failed
  lookup hides warnings). `evaluateAutoSchedule` reuses the extracted
  pure helper; no behavior change.
- **Approvals pipeline** (`ApprovalsScreen.tsx` rewritten,
  `ApprovalPipeline.tsx`, `PostPanel.tsx` `PostNotesThread` export,
  `lifecycle.ts` `readPostApprovalStates`): Draft · In review · Approved
  · Scheduled board over the same authorized reads, per-stage cap from
  new `pipelinePerStage` policy (6), shared submit/review actions,
  per-card comments threads. `page` no longer paginates (accepted,
  ignored); header count stays the review total.
- **Copy (EN+FR, owning catalogs):** 30 messages in
  `publishing.contentCopy` + `pipelinePerStage` in `publishing.contentPolicy`;
  new per-key read-path merge keeps saved operator edits across additions
  (Root saves stay strict). No registry key, no migration, schema stays 142.
- **Unresolved / next:** BEFORE/AFTER screenshots and `inspect.mjs`
  blocked (Docker blocked, no local Postgres, no Playwright browsers, no
  `DATABASE_URL`; BEFORE is source at `4742eaff`). Next: browser matrix
  at 1440/768/390 light+dark, keyboard walkthrough, tabular-figure check.

## UI wave 1 — 2026-10-23 (source/unit only, uncommitted)

All work is in the working tree, no commit/push/deploy. `npm run typecheck`
0 errors; new `tests/hubs.test.ts` (20) plus updated `app-shell` (19),
`command-palette-ui` (5) and `ux-reorg-mobile` suites pass, as do all
theme-contrast/design-token/`shell-v2`/`command-palette` suites;
`lint.mjs --app` 0 FAIL on the touched sources (14 defended WARNs).

- **Style:** `accent-ladder`, seed 1827127362, kind creator, brief "social
  media management workspace" (deal recorded in `.taste-skill/
  direction.json`). Face: brand-blue ladder (`#185FA5`/ `#85B7EB`) in
  place of the dealt raspberry; DM Sans via `next/font` (`--font-brand`,
  Inter fallback). Signature element: the dispatch rail (workspace
  color + channel avatars + health dots in the sidebar).
- **Hubs** (`src/lib/hubs.ts`, `AppShell.tsx`, `BottomBar.tsx`,
  `icons.tsx` HUB_ICONS): Create (studio tools), Plan (publishing desk +
  Tasks when used), Engage (inbox), Measure (insights), Grow (ads +
  Agency when used). Routes/areas/manifests/feature ids untouched; Home
  is the brand landing, Settings stays in the footer. Phone bar shows the
  four page hubs + raised Create; Create hub lives in the overlay menu.
- **Badges** (`PageFrame.tsx`, `inbox/server/mentions-badge.ts`,
  `analytics/alerts/server/alerts-badge.ts`): open page mentions
  (Engage), pending approvals (Plan, reused by the Approvals tab), open
  alert firings (Measure); each scoped like its list, capped at 99+,
  0-or-missing hides, failures never block. Noun in the accessible name.
- **Command bar** (`home/server/commands.ts` `listPaletteTargets`, REST
  route, `CommandPalette.tsx`): Create shortcuts (writable primary
  actions), Pages, Channels (`/inbox?channel=<id>` jumps, capped at 50);
  same server-side `q` filter on all groups; MCP `list_navigation_
  commands` unchanged (pages discovery; shortcuts need no new tools).
- **Copy (EN+FR, owning catalogs):** shell `hubs`/`hubTabsLabel`/
  `hubCounts` (old saved catalogs gain them via `resolveShellCopy`);
  command `sectionActions`/`sectionPages`/`sectionChannels` + new
  `resolveCommandCopy` merge used by `PageFrame`. No registry key change;
  schema stays 142.
- **Tokens/CSS:** sidebar 230px, topbar 48px, gutter 24px, section 18px,
  `--accent-ink` in all 8 palettes + 4 device-match mirrors, open-plane
  rails, tint-active hubs/bottom bar, avatar workspace switcher, grouped
  palette styles, skeleton flat pulse (lint FAIL fix), select-chevron
  `taste-skill-ignore` (functional CSS art). Vivid/Warm/Meta keep their
  hue families under the ladder discipline; control borders keep darker
  values (3:1 floor beats the sheet).
- **Unresolved / next:** BEFORE/AFTER screenshots and `inspect.mjs`
  blocked this lane (Docker Desktop cannot launch in the sandbox —
  `kLSNoExecutableErr` — no local Postgres, no Playwright browsers, no
  `DATABASE_URL`; BEFORE recorded from source at `469e5745`). Next wave:
  full browser matrix at 1440/768/390 light+dark, keyboard walkthrough,
  DM Sans tabular-figure check, per-screen surfaces.

## Inbox-sync + media batch — 2026-10-23 (source/unit only, uncommitted)

All work is in the working tree, no commit/push/deploy. `npm run typecheck`
0 errors; new suites `instagram-inbox-sync` (10), `media-signed-urls` (23),
`media-share-route` (9), `inbox-sync-freshness` (10), `instagram-signed-media`
(7) pass, plus `config-validation` (13, schema 142 + new-key assertions),
`post-attachments` (signed preview), `media-route-auth` (secret mock) and the
adjacent inbox/instagram/media/composer suites.

- **Instagram inbox background sync** (`platforms/instagram/jobs.ts`,
  `host.ts`, nested `config.ts` bounds): new `jobs.inbox` hook
  `syncInstagramInbox` on the shared `sync.inbox.schedule`. Fair workspace
  ring from the `sync.cursor.instagram-inbox` cursor (wrap-around, bounded
  slice per workspace, stale-cursor retry); lock-free reads through the
  existing `adapter.listComments` with per-post retries; writes under the
  workspace guard + selected-resource lock + channel lock with plan/grant/
  token/source rechecks and moved-destination guards; system
  `instagram.inbox_synced` receipts. Comments only; DMs stay missing.
- **Inbox freshness** (`inbox/server/freshness.ts`, `ui/action-copy.ts`,
  `ui/InboxActions.tsx`, `ui/InboxScreen.tsx`, `config.ts`): fresh/stale/
  never-synced header states from stored reads only, gated by new Root
  `inbox.syncStaleAfterMinutes` (60); no provider fan-out on page load
  (verified by inspection: stored reads, DB-only checks, pure reply rules).
  `actionCopy.staleNote` flows into the owning Root catalog.
- **Signed local-media pipeline** (`publishing/server/media/signed-urls.ts`,
  `app/api/media/[id]/route.ts`, `app/api/media/route.ts`,
  `publishing/components/PostAttachments.tsx`, `platforms/instagram/
  runtime.ts`): HMAC workspace-scoped expiring URLs (new Root
  `publishing.mediaShareSecret`/`publishing.mediaShareExpirySeconds`),
  uniform-404 serve path reusing `readWorkspaceImage` checks, relative
  `signedUrl` upload receipts with composer preview wiring (never
  persisted), Instagram `localImageUpload` declaration + dispatch mapping
  gated on mintable delivery (secret + exact HTTPS origin). Images only;
  stored videos stay refused.
- **Registry:** `CONFIG_SCHEMA_VERSION` **141 → 142** (three new keys, all
  consumed and asserted); Instagram worker bounds are nested
  `instagram.policy` additions with defaults, so saved policies validate.
  No migration: cursors live in `appSetting`, freshness reuses `fetchedAt`,
  grants are stateless. No route/tool/MCP change (signed query extends the
  existing media route; parity-guard passes).
- **Docs:** `OPERATIONS.md` (signed-media runbook, Instagram job/freshness
  updates), `UX-CONTRACT.md` behavior rules, `INSTAGRAM_LIVE_RUN.md` §1/§3,
  `LEGACY_CAPABILITY_PARITY.md` cells, `ARCHITECTURE.md` status, this entry.
- **Unresolved / next:** live Graph run for the inbox job (rotation timing,
  comment volume) and for signed-URL container creation (Meta fetch proof);
  per-channel worker failure state stays in Root job history by design;
  Facebook's global inbox cursor was left untouched (workspace fairness is
  Instagram-scoped this batch); browser EN/FR/theme/keyboard pass of the
  freshness header and composer preview.

## Correctness sweep — 2026-10-23 (source/unit only, uncommitted)

Three additive fixes, all in the working tree, no commit/push/deploy.
`npm run typecheck` 0 errors; new suites `ai-sentiment-provider` (9),
`instagram-rollups` (5), `staging-dry-run-outbound` (3) pass, plus
`ai-sentiment` (10), `analytics-rollups` (12), `staging-dry-run` (7),
`chat-channels-delivery` (11), `integrations-services` (48),
`integrations-events` (13) and `config-validation` (12).

- **Sentiment provider honesty** (`studio/server/ai.ts`,
  `studio/server/sentiment.ts`): `aiProviderSecretKey` helper +
  additive `Settings.provider`; sentiment gates on the configured
  provider secret and records it in provenance. Sibling assist/recap/
  alt-text unchanged. Existing `ai-sentiment` still passes (default
  anthropic); new `ai-sentiment-provider` covers all four providers,
  cross-provider key isolation and unknown ids.
- **Instagram rollups** (`platforms/instagram/rollups.ts` new,
  `analytics-host.ts`, `host.ts`, `config.ts` copy): day-series
  mapper mirroring Facebook (flows sum, reach/unversioned latest,
  non-numerics skipped; breakdown guard forces detailed reads),
  wired to the shared worker with daily/weekly read preference and
  EN/FR `rollupWeeksNote`. Range totals, audience and media stay
  detailed. No migration, no registry key, schema stays 141.
- **Staging outbound boundary** (`server/jobs/staging.ts`,
  `chat-channels/server/delivery.ts`,
  `integrations/server/webhooks.ts`, `shared-config.ts` description):
  `jobs.stagingDryRun` now also suppresses worker chat notifications
  and outbound webhook sends, auditing `chat_notification` and
  `outbound_webhook` batches. Queueing, purging, local work and
  user-initiated tests/redelivers unaffected. Docs: `OPERATIONS.md`
  boundary, `ANALYTICS_ROLLUPS.md` Instagram wording,
  `ARCHITECTURE.md` status, this entry. Existing
  `chat-channels-delivery` mock updated for the workspaceId select
  (feature-required).
- **Unresolved / next:** live sentiment run per provider; Instagram
  rollup production timing + a database rehearsal of the read
  preference; staging dry-run rehearsal covering notifications and
  webhooks jobs.

## Platform/moat batch — 2026-10-23 (source/unit only, uncommitted)

Four additive parts, all in the working tree, no commit/push/deploy.
`npm run typecheck` 0 errors; new suites
`meta-webhooks` (18), `analytics-rollups` (12), `staging-dry-run` (7),
`api-v1-contract` (5), `platform-moat-migration` (4) pass, plus
parity-guard (22), config-validation (12) and the touched
first-comment/inbox-moderation/page-labels/analytics-copy/overview-order/
due-publishing suites.

- **Meta webhooks** (`src/platforms/facebook/webhooks.ts`,
  `webhook-copy.ts`, `src/server/platforms/webhooks-http.ts`,
  `src/app/api/platforms/[platform]/webhooks/route.ts`): signed
  ingestion of Page feed/comments/messages into existing stores with
  idempotent content-free receipts in `meta_webhook_deliveries`, plus
  the Root Facebook-platform diagnostics panel
  (`modules/root/server/webhook-deliveries.ts`,
  `modules/root/ui/RootWebhookDeliveries.tsx`). New keys
  `meta.webhooksEnabled`, `meta.webhookVerifyToken`,
  `meta.webhookDeliveryRetentionDays`, `meta.webhookDeliveriesCopy`.
  Parity-guard exceptions added for both routes. Copy schema/split:
  keep `module.ts` runtime-import-free (the copy catalog lives in the
  leaf `webhook-copy.ts`; importing `webhooks.ts` from `module.ts`
  reintroduces a registry cycle).
- **Analytics rollups** (`src/modules/analytics/rollups/`,
  `src/platforms/facebook/rollups.ts`, read preference in
  `facebookAnalyticsHost.load`): nightly `analyticsRollups` job,
  `analytics_rollup_daily`/`_weekly`/`_runs` tables, weekly cascade
  with catalog disclosure. New keys `analytics.rollups.schedule`,
  `analytics.rollups.policy`; `meta.pageAnalyticsCopy` gained optional
  `rollupWeeksNote`.
- **Staging dry-run** (`src/server/jobs/staging.ts` + gates in
  `jobs/sync.ts`, `first-comment-jobs.ts`, `inbox/moderation.ts`):
  Root switch `jobs.stagingDryRun` suppresses worker provider
  dispatches and audits `worker.staging_dry_run` batches.
- **API v1**: no route change; `docs/API_V1.md` pins the versioned
  contract (source-checked), `docs/INTEGRATIONS.md` gained the two
  previously undocumented metric-alert operations.
- **Migration** `20261103050000_platform_moat` (additive, sorts after
  engagement alerts). Not applied anywhere: no scratch Postgres was
  reachable from this lane (docker socket denied, no local server),
  so apply + a live rollup/webhook rehearsal remain for a lane with a
  database. Schema 140 -> 141; `security.apiRequestsPerMinute` text
  now covers inbound webhooks.
- **Unresolved / next:** live Meta subscription + delivery proof;
  rollup production timing comparison; dry-run rehearsal on staging;
  `meta_webhook_deliveries` has no workspace FK by design (retained
  operational history); weekly Instagram rollups need an Instagram
  `rollups` mapper; `data-control` recent-table Postgres checks for
  the four new tables still need a database run.

## Ads manage tabs — 2026-10-23 (source/unit only, uncommitted)

`/ads/manage` reorganized into Campaigns / Ad sets / Ads / Creatives
URL tabs (`?level=`), replacing the mixed level-dropdown +
metrics-sorted table with per-tab stored-data tables. All work is
ads-module owned (`ui/objects/`, `directory/server.ts`, `copy.ts`).

- **Screen** (`ui/objects/ObjectsScreen.tsx`): `LinkTabs` preserve
  period/account/search, restart paging, drop inapplicable parent
  filters; old `?level=campaign|adset|ad` links, legacy sort params
  and `/ads/campaigns` deep links (`?level=&q=`) keep loading;
  `level=adgroup` aliases to ad sets. Per-tab tables show name,
  parent, stored status, spend, last delivery, updated + the existing
  `ObjectManager` (rename, pause/resume, budget, creative assignment,
  delete where the platform advertises it). Creation under each list:
  `CampaignCreateForm`, `AdSetCreatePicker`, `AdCreatePicker`,
  `CreativeCreateForm` — all through the existing preview/apply
  management services, policies and scopes.
- **Creatives tab**: no provider read on page load; `CreativesBrowser`
  fetches `view=creatives` only on explicit member request with
  account picker, cursor paging, preview/status columns and honest
  read-only note (no creative rename/pause/delete exists).
- **Services**: `readAdsDirectory` items gain additive inventory
  `status`; no MCP tool, route or registry change (no MCP_PARITY edit,
  no CONFIG_SCHEMA_VERSION bump); no migration.
- **Copy**: 12 new `manage*` EN/FR customer keys in `ads.customerCopy`.
- **Tests**: new `ads-manage-tabs` (routing/params, copy),
  `ads-manage-directory` (status merge, error paths),
  `ads-manage-tabs-ui` (pickers, browser incl. error/empty/cursor).

Evidence: `npm run typecheck` 0 errors; 7 new/adjacent suites (43
tests) + 11 guard/parity/copy suites (146 tests) pass. No browser,
provider, database or production verification. No commit/push/deploy
(not authorized this lane).

## Engagement batch — 2026-10-22 (source/unit only, uncommitted)

Revalidated the brief against the tree first: scheduled reports and
inbox bulk actions already existed end to end (worker job, mail
delivery, run history, bulk UI/REST/MCP), so this batch adds the
missing pieces only and wires the notifications between them.

- **Metric alerts** (`src/modules/analytics/alerts/`, owned by
  Analytics): rules + firings tables, CRUD service on `authorizeReport`
  (managers write), worker evaluation on stored neutral measures, new
  `analyticsAlerts` job, Reports-page panel, `GET/POST
  /api/analytics/alerts`, `list_metric_alerts`/`manage_metric_alert`
  MCP tools. New Root keys `analytics.alerts.schedule`,
  `analytics.alerts.policy`, `analytics.alertsCopy`; schema 139 → 140
  (registry + both `config-validation` pins + new key assertions).
- **Inbox triage views** (`src/modules/inbox/saved-views*.ts`,
  `server/saved-views.ts`, UI `InboxSavedViews`): personal views in
  the shared `saved_views` table (screen `inbox`), filter-row UI,
  `/api/inbox/saved-views` (+`[id]` DELETE), three MCP tools. No
  migration (free-text screen column, workspace FK discovery covers
  export/erasure).
- **Inbox full-text search** (`server/search.ts`): ranked
  `plainto_tsquery('simple')` over stored messages/top-level comments,
  `GET /api/inbox/search`, `search_inbox` MCP tool, GIN indexes in the
  batch migration. No new UI (the list `q` filter is unchanged).
- **Notifications** (`src/modules/settings/notifications/`): new kinds
  `metric_alert`, `report_delivered`, `triage_assigned` (contracts,
  event copy with per-entry defaults so old saved catalogs validate,
  eligibility, preference keys/columns/UI toggles, family labels).
  Emitters: alert evaluation (in-tx), scheduled-report completion
  (best effort, receipt stands), assignment change (in-tx, new owner
  only; bulk shares the service). Delivery pipeline unchanged.
- **Migration** `20261103040000_engagement_alerts` (additive; sorts
  after `..._autopilot_variants_linkcache`): 2 tables, 3
  `notification_settings` columns, 2 FTS indexes, purge triggers.
- **Docs:** `ARCHITECTURE.md` status note, `OPERATIONS.md` alert
  runbook, `MCP_PARITY.md` tool/alias/coverage rows, `UX-CONTRACT.md`
  behavior rules, `data-control/README.md` table rows, this entry.
  Saved `settings.uiCopy` catalogs fall back to shipped defaults
  until Root re-saves (new label keys; designed behavior).
- **Tests:** new `metric-alerts`, `metric-alerts-evaluate`,
  `metric-alerts-ui`, `engagement-batch-migration`, `inbox-saved-views`,
  `inbox-search`, `notifications-engagement(-ui)` suites; extended
  `inbox-productivity` (notification mock + triage test) and
  `analytics-copy` (alerts catalog). Existing suites updated only
  where the feature required it (notification mock in the assign
  path, alerts catalog in the copy inventory).

Evidence: `npm run typecheck` 0 errors; new suites pass; 156-file
targeted run (inbox/report/analytics/smoke/copy/config/notification)
green; `parity-guard`, `module-manifests`, MCP scope/exec/security
suites pass. No full suite, no browser, no provider, no production
verification. No commit/push/deploy (not authorized this lane).

## Meta Llama AI text provider — 2026-10-22 (source/unit only, uncommitted)

Fourth AI text provider beside anthropic/openai/gemini, text-only through the
shared port (composer assist, report recaps, comment sentiment, alt-text
suggestions); no image/voice/video ports added.

- **Adapter** `studio/server/llama.ts` (`llamaPort`): Meta-hosted Chat
  Completions, OpenAI-compatible wire format. Endpoint, Bearer auth, request
  shape (`model`, `messages`, `max_completion_tokens`), response text at
  `choices[0].message.content`, and `image_url` vision blocks (base64 `data:`
  URLs included) verified 2026-10-22 against Meta's current docs (dev.meta.ai
  Chat Completions protocol + image understanding). Failures map to the same
  fixed messages as the sibling adapters and never expose provider text.
- **Config** (`studio/config.ts`): `AiProviderId` + `AI_PROVIDER_CHOICES`
  gain `llama` ("Meta Llama"); `AI_DEFAULTS` gains
  `llamaModel: 'Llama-4-Maverick-17B-128E-Instruct-FP8'` and
  `llamaEndpoint: 'https://api.meta.ai/v1/chat/completions'`; new Root keys
  `ai.llamaApiKey` (secret), `ai.llamaModel`, `ai.llamaEndpoint`.
  `studio/server/ai.ts` gains the `PROVIDER_KEYS` entry and the batch keys.
  The Root `ai.provider` select renders from the registry options, so the new
  choice appears with no UI edit.
- **Registry:** `CONFIG_SCHEMA_VERSION` **138 → 139**; both pins in
  `tests/config-validation.test.ts` updated.
- **Strings:** no new customer strings — provider identity never reaches
  customer surfaces (verified: no UI/copy references any AI provider; all
  failures use the existing provider-agnostic messages). The "Meta Llama"
  label is Root-only.
- **Docs:** `ARCHITECTURE.md` status note; this entry.
- **Not verified:** no live Llama call (none permitted this lane); default
  model id comes from third-party Llama API integrations, not the current
  Meta docs page (which now leads with Muse models) — confirm the id and
  endpoint against a live key before release. Pre-existing note: sentiment
  additionally gates on the Anthropic secret (`sentimentSettings`), so it
  needs an `ai.apiKey` value regardless of provider; unchanged by this lane.

Evidence: `npm run typecheck` 0 errors; `tests/ai-provider-ports.test.ts`
(Llama success/key header/body, vision, non-ok/unreadable/empty/abort),
`tests/config-validation.test.ts` (schema 139 + Llama keys + select choice),
`tests/ai-assist.test.ts` (Llama key resolution), `tests/ai-alt-text.test.ts`
(Llama vision block).

## Idea batch 2 (autopilot + planning) — 2026-10-22 (source/unit only, uncommitted)

Owner-approved idea batch 2 of 4. Four features, all usable end-to-end at
source/unit scope:

- **Supervised autopilot tiers** (`studio/agents/server/autopilot.ts`,
  `scheduled.ts`, `AgentsPage/ScheduledAgents`, `manage_autopilot_tier` MCP,
  `POST /api/agents/scheduled` `action: tier`): per-workspace tier
  (manual/assisted/supervised-auto) in `autopilot_policies`, guardrails
  (daily cap, quiet hours, channel scope, drafts-only channels, new/uncertain
  destinations, approval rule) narrowing Root `agents.autopilotPolicy`
  ceilings. Worker executes; every auto send/refusal audited with
  `actor: 'autopilot'` + tier (`actorId` NULL worker rows); queue/Posts/
  Calendar show the Autopilot origin badge; run history shows tier + send
  count. Tier changes are owners/admins-only with exact confirmations.
- **Best-time engine, per-Page** (`publishing/server/best-time*.ts`,
  composer + queue-reschedule UI): same stored-only reads (no live fan-out),
  plus per-channel slots with measured basis and honest reasons
  (`insufficient_history` with the count, `no_lift`, `unsupported`,
  `no_access`), a why-line per slot, and the existing suggest/apply mode.
  Combined suggestions still need every destination behind one cell. REST and
  `get_best_times` share the extended shape.
- **Per-language post variants** (`publishing/server/post-variants.ts`,
  `post-variants-mcp.ts`, `/api/publishing/post-variants`, composer Languages
  section): new `post_language_variants` table + nullable `targets.locale`;
  deterministic exact→language→default fallback; publish-time selection per
  destination in `publishPost`; text-only (pipeline sends one media set per
  post — no media override). Destination locales are API/MCP-managed; the
  editor shows the effective language per destination.
- **Composer link preview** (fetch service in Studio content-tools with the
  Publishing-owned net-guard; `link_preview_cache` with Root TTL; composer
  card): fresh entries served without fetching or hourly claims; misses fetch
  once and cache usable previews; "no preview" never cached; renders read the
  cache only (`GET /api/publishing/link-preview`); honest unavailable/failure
  states; EN/FR.
- **Migration** `20261103030000_autopilot_variants_linkcache` is additive
  only (3 tables + 1 nullable column + purge-gate triggers); all new readers
  tolerate a missing table mid-deploy.
- **Config:** `CONFIG_SCHEMA_VERSION` **137 → 138** (required: three new
  registry keys — `agents.autopilotPolicy`, `ai.linkPreviewCache`,
  `publishing.postVariantsMaxPerPost`; `src/lib/config/registry.ts` says bump
  when a key changes, and `tests/config-validation.test.ts` pins the version
  in two places — both updated). New copy keys follow the established
  fallback conventions.
- **Docs:** `OPERATIONS.md` autopilot runbook, `UX-CONTRACT.md` behavior
  rules, `BEST_TIMES.md` + `MCP_PARITY.md` + `LEGACY_CAPABILITY_PARITY.md`
  cells, this entry, `ARCHITECTURE.md` status note.

Evidence: `npm run typecheck` 0 errors; new suites pass (autopilot-tiers,
autopilot-tier-ui, autopilot-origin, autopilot-batch-migration,
best-time-pertarget, post-variants, post-variants-surfaces, post-variants-ui,
link-preview-cache, link-preview-card-ui) plus touched suites
(scheduled-agents, scheduled-runs-transport, best-time-service,
best-time-surfaces, best-time-ui, best-time-ranking, best-time-apply,
best-time-queue, config-validation, ai-composer-checks, ai-content-tools-http,
publishing-composer-catalog, publishing-error-copy, pubinbox-gap-ui,
publishing-held-schedule-screens, agents-authorization, agents-service,
mcp-scope-host-matrix, mcp-exec-host-services, post-composer-page,
composer-queue-ui, composer-queue-actions, publishing-origin-filter,
recipe-origin-visibility, publishing-lifecycle, publishing-native-schedule,
jobs-due-publishing, publishing-scheduling-verification,
workspace-operations-publish, publishing-rest-writes, publishing-bulk,
mcp-security, publishing-remote-hold, request-locale,
client-zoned-time-formatting, content-v2). No full suite (not run per batch
instructions), no browser, no provider, no production verification.

## AI Studio module — 2026-10-22 (source only)

Owner directive: AI Studio is its own product module. `src/modules/agents/`,
`src/modules/ai/` and `src/modules/caption-tests/` were vacated and deleted;
all code now lives in `src/modules/studio/` (manifest, config, mcp, `agents/`,
`content-tools/`, `caption-tests/`, `server/`, `components/`, `ui/`; see
`src/modules/studio/INTEGRATION.md`).

- URLs unchanged: `/content/ai-studio`, `/content/agents`, `/insights/tests`,
  `/api/ai/*`, `/api/agents/*`, `/api/caption-tests/*`. No route moves, no new
  redirects. Feature ids renamed (`studio/ai-studio`, `studio/agents`,
  `studio/tests`) with preserved role access; tabs and palette order unchanged.
- Root keys unchanged (`ai.*`, `agents.*`, `captionTests.*`,
  `publishing.captionTestsSchedule`); schema stays **137** (no bump:
  `tests/config-validation.test.ts` pins 137 and passes; new copy keys fill
  from shipped defaults so saved catalogs keep validating). Explicit key
  declarations now win over another module's prefix in `configurationOwner`
  (only `publishing.captionTestsSchedule` changes owner, to Studio).
- MCP tool names unchanged; agent-tool features are `studio/agents`
  (`docs/MCP_PARITY.md` updated). Composer screens call the Studio-owned AI
  service; no duplicated AI logic.
- New: scheduled-run history (newest first, from the audit trail) in the
  `list` response shared by UI/REST/MCP, rendered on the Writing-agents
  screen; "Plan with AI" cross-links (recipe planner, queue automation) on
  all three Studio screens with EN/FR catalog copy. Worker `scheduledAgents`
  handling already existed and is unchanged.
- Saved Root customizations preserved except: the three renamed shell tab
  labels (fall back to shipped text) and the orphaned
  `entitlements.modules.agents` / `entitlements.features.agents|publishing/ai-studio|analytics/tests`
  keys (regenerated `studio` keys default to available).
- Evidence: `npm run typecheck` 0 errors; touched vitest files pass
  (manifest/guard/redirect/shell/content, agents/ai/caption/scheduled,
  mcp-security/scope/exec, config-validation, parity-guard, root-module,
  copy suites). No full suite, no browser, no provider, no production run.

## Current HEAD reconciliation — 2026-10-21

Reviewed source: `99c41554`; registry schema **123**. This section supersedes
older present-tense source claims below. It does not identify the deployed SHA.
The last dated deployment statement in these docs names `a910d774`/120; confirm
the actual release and migration receipts in a separately authorized session.
The full contract remains active and incomplete.

- **Ads inventory (`e050b3a6`):** neutral `ads_objects` stores objects independently
  of delivery insights. Confirmed creates/renames/status/deletes update inventory
  with audit/settlement; deletes retain hidden tombstones. Facebook account-edge
  discovery populates campaigns/ad sets/ads without delivery, rejects incomplete
  pagination and rechecks access before writes. Campaigns/Objects and existing
  REST/MCP directory/management services can manage paused objects with no daily
  rows; ownership and scope checks remain. Migration
  `20261101120000_ads_object_inventory` is authored, not verified applied here.
  Rehearsal pins/probes, export/erasure coverage, stale-sync/database rollback and
  externally deleted-object reconciliation remain open; see the Ads server README.
- **Live Ads (owner report in this lane request):** create, rename and delete were
  verified in Ads Manager. This supersedes the blanket claim of no live Ads write
  or pending grant for that run only. Object levels/identities, test account, exact
  consent/audit receipts, final cleanup and zero spend are not supplied here; this
  is not proof of every budget, status, creative, recovery or MCP operation.
- **Contract fixes (`8d9ccbe7`):** connection lifecycle and account policy now live
  in Settings; residual draft helpers live in Publishing, with shared compatibility
  re-exports. Ads runtime locale, bilingual management transport/captions,
  configurable recovery/creative/parent-id bounds and Facebook Ads presentation
  copy are integrated. `storage.mediaPresentationPolicy`, `ui.loadingCopy` and
  `root.errorCopy` are registered (old lane requests to register them are stale).
  Shared validation has EN/FR defaults, but `shared.formValidationCopy` registration
  and serialized Root delivery are still absent. Agency service now requires
  `SELECT WORKSPACE <id>`; **AppShell still posts only workspaceId**, so switching
  there is blocked until the caller sends the service confirmation. Sharing
  copy-only edits now require exact service confirmation and preserve the address.
  Audit report annotations and module handoffs retain historical pending claims;
  use current source to determine what remains.
- **Numbers (`d1702ef9`, `99c41554`):** channel Analytics excludes paid metrics;
  Ads has separate reporting. Home spend uses retained numeric spend rather than
  re-parsing provider fields. Empty stock totals stay unknown; daily stocks take
  the latest observation per resource/day instead of summing overlapping windows.
  Synthetic fixture checks cover currency separation, ratios, audience coverage
  and retained-day freshness. See `src/modules/home/server/NUMBERS_EVIDENCE.md`.
  Remaining adapter gaps: Home Page-only performance, external destination metric
  coverage/deduplication, audience trend identity and nested reaction breakdowns.
- **Design/accessibility/French:** merged Publishing/Inbox redesigns, Settings and
  Root passes, thumbnails, Inbox scrolling/media URL recognition, table/focus and
  EN/FR copy tests are source/unit/DOM evidence. The requested design rounds 1–2
  are not a completed two-round browser record: HEAD includes the shared layer
  labelled round 4 (`design-pass-round4.test.ts`). No new visual browser, keyboard,
  contrast or screen-reader result was collected. Round 6 browser harness remains
  partial; earlier matrix findings retain their dated scope.
- **Smoke/performance/MCP:** auto-discovered page/route smoke checks exercise
  anonymous/owner/member/viewer in EN/FR with synthetic mocks and server rendering.
  They are not real browser or live HTTP/MCP tests. Known waivers include
  signed-in 401 versus 403, sign-out Origin acceptance, validation-before-auth and
  joined-row fixtures. Read-path/query-budget and Inbox search tests do not prove
  production speed. Scoped MCP host/service and HTTP tests are execution evidence
  with mocks, not a real authenticated MCP-client run.
- **Requested work absent at this HEAD:** Instagram has discovery/metric helpers
  and selection tests, but `PLATFORM_MODULES` installs Facebook only; no complete
  Instagram module. Facebook Groups publishing/discovery is absent (Settings
  channel groups are organization only). AI writing/recap/sentiment exists, but
  rebuild AI agent management does not. Posts CSV is a bounded synchronous
  `exportPublishingPosts` download, not an asynchronous export job; workspace ZIP
  is separate. Do not mark these legacy capabilities complete.
- **Missing sweep input:** `LEGACY_SWEEP_2026-10-21.md` is absent from this checkout.
  Its missing rows cannot be reconciled from an unavailable report. Keep the
  Instagram, Groups, AI-agent and async-CSV gaps above explicit; integrator must
  supply the report and reconcile every additional row without reducing scope.

## Design v2 B1: shell (2026-10-22, source only, uncommitted)

Built per [design-v2/08-BUILD_PLAN.md](design-v2/08-BUILD_PLAN.md) B1. Evidence: typecheck 0 errors; full suite (excluding the Facebook diagnostic transport file) 704 files passed, 49 skipped, 11,403 tests passed; jsdom tests `app-shell`, `shell-v2`, `route-redirects`, `popup-placement-avatar`. **No browser, screenshot, keyboard-in-browser or screen-reader run.**

- **Shell:** `AppShell` is one collapsible sidebar (areas Home, Content, Inbox, Insights; Tasks and Agency only when used; Settings and the account menu in the footer; collapse to a 64 px rail, remembered in `sp_sidebar`), a top bar (menu and channel-scope chip below 1024 px, Page tools, command palette), a phone `BottomBar` with a raised Create button, and area link tabs above the content (overflow into "More"). Workspace switching now sends the exact `SELECT WORKSPACE <id>` confirmation (closes DELIVERY_PLAN item 1). Theme moved into the account menu; `ModeToggle` is no longer mounted (file kept for `appearance-provider-persistence` test; delete in B9).
- **Channel scope:** `src/lib/channel-scope.ts` (`channel` URL parameter, legacy names read, cookie `sp_scope_<workspaceId>`, validation notice). `PageFrame` loads the member's selected channels (`modules/shell/server/channels.ts`). The sidebar and the scope chip share one state. **Pages do not yet read it:** each area batch must call `requestChannelScope()` (`server/context.ts`) and drop its own `channel`/`channelId`/`target*` query names. A multi-channel `channel=a,b` is unknown to today's single-channel pages until they migrate.
- **Page tools (transitional adapter):** the old `sidebar` prop and every `SidebarDock` portal render inside a modal sheet (side on desktop, bottom on phone) that stays mounted, so docked form state survives closing it. B9 deletes `SidebarDock` and the adapter. Root keeps its section navigation inside the sidebar (`installationMode`).
- **Components:** new `Popover` (fixed position, no portal; inline so dialogs and tests work), `InfoTip`, `ChannelScopeList`, `BottomBar`, `SidePanel`, `ListRow`, `SplitButton`, `ActionBar`, `DateRangePicker`, `FilterButton`, `LinkTabs`, `ShellCopyProvider`. `Menu` and `Select` now use `Popover`; `usePopupPlacement` is deleted. `PageHeader` has no icon chip and gains `count`, `info`, `tabs`, `filters` (descriptions still show as text; moving them into ⓘ is per-screen work in B2 to B8). `MetricCard` gains `info`. `Drawer` gains `variant="sheet"`. `DataTable` is unchanged (B3).
- **Config:** new Root keys `home.shellCopy` (EN/FR chrome and page-tab labels, keyed by page id) and `home.shellPolicy` (list lengths, tab overflow, cookie names and lifetimes, hover delay). Page labels live in the catalog, not in manifests (only `area` was added to manifests). Integrator bumps `CONFIG_SCHEMA_VERSION` (unchanged).
- **Routes:** manifests may declare `redirects`; `src/lib/route-redirects.ts` and the middleware serve them as 308 with parameter mapping. None are declared yet (B2 starts with `/publishing/compose` to `/create`). Sign-in already lands on Home; deep-link return is unchanged.
- **Open:** unread/pending badges on Inbox and Content, owner switch for Tasks and Agency in Settings, language switch in the account menu, Help target, tablet overlay and rail in a real browser, `DataTable` phone rows, `Notice` unification, all screenshots and the 06 §4 checklist.

## Design v2 B2 (Create) and B3 (Content) (2026-10-22, source only, uncommitted)

Built per [design-v2/08-BUILD_PLAN.md](design-v2/08-BUILD_PLAN.md) B2 and B3. Evidence: `tsc` 0 errors; full suite (without the Facebook diagnostic transport file) 706 files / 11,438 tests passed, 0 failed; jsdom and server-render tests (`post-composer-ui`, `composer-queue-ui`, `publishing-ui-round2`, `content-v2`, `content-v2-server`, `post-attachments`, `calendar-board-ui`, `route-redirects`, `app-shell`). **No browser, screenshot, keyboard-in-browser or screen-reader run; no server, migration, deploy or provider call.**

- **Routes:** Publishing pages moved to `/content` (Posts), `/content/calendar` (+ `/dates`, `/seasons`, `/trends`, `/feeds`), `/content/queue`, `/content/approvals`, `/content/library` (Media) with sections `/content/library/{templates,labels,fields,feeds}`, `/content/post/[postId]`, `/content/ai-studio`, and `/create`. The publishing manifest declares the 308 redirects (`/publishing/*` → new routes, `collaboration/post/*` → `/content/post/*`, `collaboration` → `library/fields`; `channelId`/`target`… map to `channel`). `route-redirects.test.ts` asserts every redirect points at a route file that exists. `src/app/publishing/**` is deleted. Templates, Labels, Fields and Feeds are `navigation: false` pages (Library section tabs, not area tabs); `AppShell` keeps the parent tab current for them and for post pages; Library's tab label comes from `home.shellCopy` (`publishing/media`: Library / Bibliothèque).
- **Create (`ui/compose/*`):** `PostComposer` is a full-screen modal sheet (top bar with close and Templates, Edit | Preview switch on phones, editor + sticky preview, `ActionBar`). Channels are toggle chips (scope from the sidebar pre-selects them; a lone postable channel is chosen for you; channels that cannot publish show "Reconnect"). Text, Media (drop zone, Upload, From library via `LibraryPicker` on `GET /api/media`, Add link), collapsed first comment, and a "More options" disclosure (format per channel, who sends). Action bar: Save draft and a `SplitButton` Schedule ▾ with Publish now (confirmation dialog), Add to queue (shows the next slot; retries when queue times cannot be read) and Schedule… (popover with date, time and Best-time chips). **Publish now is a schedule `publishNowLeadMinutes` (default 2) ahead, sent through the same `schedule` intent and server action; the delivery worker then publishes it.** Closing with unsaved content asks first. All save paths are the existing actions (`createPostWithRecoveryAction`, `saveQueueComposerAction`, `autosaveDraftAction`); a failure keeps every field and shows an alert in the action bar.
- **Content:** Posts (`PostsScreen`, `PostsHeaderTools`, `PostsTable`): one Filter button (status, created by, saved views), chips, search, Export (drawer), Import CSV, Create; the Feed and Cards views and their saved-view value are gone; the table opens a `SidePanel` (preview, destinations with status, the existing row actions) and keeps `?post=` shareable (a post not on the page redirects to `/content/post/<id>`); phones get 72 px `ListRow`s that open the post page. Calendar: toolbar in the page (‹ Today ›, range, Month | Week, Filter, "More calendars" for Key dates/Seasons/Holidays/Subscriptions), free queue times as dashed pills that open Create at that time (`free-slots.ts`, `readQueueSlots`), month pills bounded by policy. Queue: next-in-queue list plus a 360 px panel with the weekly queue times and, under "Automation", the content mix (both moved out of the old Organize screen; `/content/library/fields?view=queue|mix` redirects to `/content/queue`). Approvals: review cards with the full preview, Approve, Request changes (note first) and A/R keys that move focus (the decision itself still needs Enter or a click); the Approvals tab shows the pending count (`pendingApprovalCount`, `PageFrame` → `AppShell.tabCounts`). Library: `LibraryHeader` (title, ⓘ, section tabs gated by feature), Media as a thumbnail grid, Templates/Labels/Fields/Feeds inline toolbars instead of sidebar docks. Post page: `PostPreview`, destinations and status above the existing notes/versions/labels/fields panel.
- **Channel scope:** `modules/shell/server/scope.ts` (`pageChannelScope`) reads `channel` (then cookie) for Create, Posts, Calendar, Queue and Approvals. Several channels are "any of": `publishingPostReadQuery` now accepts comma-separated `channelId` (REST `channel`, MCP `list_posts.channelId`), and `postId` (REST `post`, MCP `list_posts.postId`) for one visible post; Calendar narrows the authorized read in the page. Pages no longer read their own `channelId`/`target` names. Library screens do not use the scope.
- **Config (new Root keys; integrator bumps `CONFIG_SCHEMA_VERSION`, not changed here):** `publishing.contentCopy` (EN/FR catalog of Create and Content; placeholders are validated) and `publishing.contentPolicy` (`publishNowLeadMinutes`, `monthPostsShown`, `freeSlotsPerDay`, `libraryPickerMaxSelect`, `reconnectHref`). Existing catalogs (`publishing.composerCopy`, `uiCopy`, `labelCopy`, …) are unchanged, so saved Root edits keep working.
- **Deleted (superseded):** `PostFilters`, `PostsViewSwitch`, `CalendarFilters`, `PublishingSidebar(Client)`, `ApprovalsTable`, `PublishingChannelOptions` and their tests. `PostActions` and the Queue/Content-mix forms no longer mount a `SidebarDock`; remaining dock users are outside this batch (calendar extras, AI studio, Settings, Root, Tasks, Agency, Reports).
- **Open / not done:** (1) no browser, FR, keyboard, contrast or screenshot evidence; (2) Posts has no date-range or label filter (the read service has neither); (3) "Customize per channel" text overrides, labels and custom fields in Create's More options are not built (no service for per-channel text); (4) Library Media is a grid but has no detail sheet; Templates, Labels, Fields and Feeds are still the earlier tables/forms; (5) Approvals keys only move focus; (6) the legacy live-verification scripts (`scripts/verify-*.ts`) got new URLs only; their Playwright selectors for the old composer dock must be rewritten before a browser run; (7) `Take photo` on phones relies on the OS file picker (`accept` lists image types; no `capture` attribute); (8) Publish now has no undo window (the old per-post undo-send applies to existing posts only); (9) `SidebarDock`/Page tools adapter stays until B9.

## Calendar extras install (2026-10-22, source only)

The `calendar-extras` module is installed (config, MCP, pages, API and ICS routes, sidebar links, board marks, queue season hook, Analytics chart notes, refresh jobs); see ARCHITECTURE.md "Calendar extras install". The integrator must bump `CONFIG_SCHEMA_VERSION` for the new Root keys `calendarExtras.policy`, `calendarExtras.customerCopy`, `calendarExtras.refresh`, `calendarExtras.holidaysSchedule`, `calendarExtras.trendsSchedule`. Still open: PostgreSQL execution of the retained-table SQL, live holiday/trend fetch, browser design/FR/keyboard passes, real calendar client, authenticated MCP client run, data-control rows for retained tables, and public-route throttling/log redaction for `/api/calendar-feed/[token]` at the proxy.

## Required context

Read ARCHITECTURE_CONTRACT.md, ARCHITECTURE.md and GOAL.md; follow DELIVERY_PLAN.md,
LEGACY_CAPABILITY_PARITY.md and MCP_PARITY.md. UI work reads ../DESIGN.md and
../UX-CONTRACT.md; migration/release work reads CUTOVER.md and the dated results
in RELEASE_GATES_PLAN.md. Revalidate deployed SHA and migration ownership before
release work; source and historical receipts do not identify current deployment.

## Production record

Historical deployment snapshot (owner/integrator statement): `ffdb1cdf`, schema **118**,
with migration `20261031180000_rebuild_ads_ad_creation` applied in production
(owner/integrator record; not observed here, and no receipt such as a
`_prisma_migrations` row or CHECK probe is in the repository; confirm it). Owner cutover: 2026-10-20 22:09 CEST, release `5f1e52d7`, via
`rebuild/scripts/prod-cutover.sh` (one-shot, removed after use), origin https://social.newsgeet.com. Rebuild
web/worker recorded active/enabled; legacy inactive/disabled. The legacy tree
was deleted from the repository on 2026-10-22 (lane 47); server-side removal
via `rebuild/scripts/server-legacy-cleanup.sh` is still pending, and there is
no legacy rollback target anymore. Releases use `rebuild/scripts/prod-deploy.sh`.
Keep one publisher. `app.publicOrigin` is the
proxy-facing same-origin source; do not substitute internal listener addresses.

The dated release log records backup/migrations/ownership repair, owner sign-in,
AI checks and Chrome sweep, then MariaDB read-only access, image/JPEG storage and
80 planned recipe posts across 10 Pages. First live 07:00 Europe/Paris batch:
10/10 published, 10/10 comments, one Page inspected in owner browser. The first full
recipe day (07:00, 11:00, 15:00, 17:00) published 40/40 posts with 40/40 first
comments and no errors; 70 plans remain pending on the rolling horizon. The original
comment included an article preview; the owner subsequently removed the link.

Post-cutover rollback drill (2026-10-21, `prod-rollback-drill.sh`): a backup
restored into scratch database `social_pilot_drill`; legacy (`/srv/ms-social-pilot`)
and the installed rebuild started on spare ports against it. **ROLLBACK DRILL PASS**
(restore 2 s, legacy 3 s, rebuild 2 s, total 7 s); scratch database/role removed;
live rebuild web/worker stayed active and legacy inactive. This proves a restorable
backup and startable rollback artifacts. It does not prove a proxy cutback, media
restoration, a restore of the newest migrations, or worker/systemd shutdown timing.
The drill is rebuild-only since lane 47 (legacy half retired with the legacy release).
`2e23223a` records backed-up/audited updates to 80 scheduled comments and changes
truncation to preserve a link only when the template contains `{link}`. Do not
restore that link based on old prose or equate planning with delivery.

Live Graph v26.0 post-insights probe accepts `post_media_view`,
`post_total_media_view_unique`, `post_reactions_by_type_total`, `post_clicks`,
`post_clicks_by_type`; rejects `post_impressions`, `post_impressions_unique`,
`post_engaged_users`. `63207a7c`/`954e80cb` fix time-window paging. Recorded probe:
no failures, views/unique 3, one like; summary edge 0 versus insight 1 remains
unexplained (lag is a hypothesis). This is limited eligibility evidence, not full
history/metric coverage. OpenAI/Gemini have earlier limited live success;
Anthropic was blocked by account credit. Mail and live recovery remain open.

## Integrated source and automated scope

- Copy (`38ab34f4`, `fb42b056`, `93944199`, `5e6841ee`): typed Root EN/FR catalogs
  across Publishing, Inbox, Analytics, Ads, Home, Tasks, Agency, Feeds, Media and
  Sharing; last three include service/public error localization. `configOrDefault`
  validates runtime or registry default; `configValueOrDefault` checks outer shape
  only. Residual literals/prompts/dynamic labels and stale OAuth metadata remain
  in CONFIG_LITERAL_AUDIT. Schema 118 describes round 9; current source is 123.
- Appearance (`2b42470b`): global shell and Settings save through confirmed
  appearance service; theme in users, mode under exact account key, transaction
  audit, Root-lifetime cookie cache and validated-session fallback in layout.
  Former direct-cookie/cookie-only missing-source claims are superseded.
- Parity (`f5c21c96`, `acb56bd7`, `e105bff5`, `8f423ec7`): Inbox bulk REST exists;
  draft aliases and canonical session REST/MCP share api-writes lifecycle, and
  v1 create now requires exact CREATE POST consent. Guard checks 238 customer/
  person tools plus 51 Root tools and resource mappings. All 48 former Root
  exceptions removed; 24 exact auth/protocol exceptions remain. Root create/
  rename MCP and workspace directory GET added. Inventory closure does not prove
  all services own identity/limits/confirmation; follow MCP_PARITY boundary list.
- Recipes (`d68fc5c1`, `e43d16d2`, `6c2b7a6f`): date/ID order, retry/reconciliation,
  pause-cancel via Publishing, cached pool estimates, worker summaries, origin
  badges/filters, Feeds sidebar link, bilingual status/supply/next-time card and
  Root visibility bounds. Fake/unit/render evidence for follow-ups, not live
  recovery. Round 6 closes refused-batch starvation and channel/time reconciliation at
  unit level (details below). Claims lacking a stored post id remain uncertain.
  Preserve uncertain ledgers; live recovery is unproven.
- Reliability (`e0584777`, `d511e39c`): Facebook Inbox, Page analytics/history and
  Ads fetch outside locked writes; current binding/access/purge rechecks before
  persistence. Signals stop claims, request safe stops, drain with Root grace/
  poll settings, then abort/release abandoned leases. Unit evidence supersedes
  missing-source reports; production stop duration/systemd/DB contention unproven.
- Data (`4b13204b`, `83b26ba9`, `46c6bdae`): recent-table ownership catalog and
  explicit OAuth/profile/account hooks, exact appearance cleanup, Root/unverified
  deletion hooks. Partial account export is now exposed: session-only
  `GET /api/settings/account/export`, installed MCP tool `export_account_data`
  and a bilingual Account download with explicit included/excluded coverage;
  bearer credentials are refused. Coverage stays **partial** (not the owner ZIP).
  Supplementary purge migration `20261031150000_rebuild_supplementary_purge_gates`
  still needs rehearsal pins and PostgreSQL proof; no complete export/erasure claim.
- Settings/Root boundaries (`46c6bdae`): single and batch connection selection and
  disconnect callers (browser, REST, MCP) call `changeConnectionSelections` /
  `changeConnectionDisconnect`; the browser sends the named retain/delete consent.
  Root workspace create/rename, directory (actor-checked), configuration save
  (exact confirmation, in-transaction actor recheck, availability inventory for
  every caller) and error resolution moved to `src/modules/root/server/`
  (`workspace-controls`, `directory`, `configuration`, `errors`); `src/server/root/*`
  re-export them. Mocked/unit evidence (`tests/root-config-authority.test.ts`,
  `root-workspace-controls.test.ts`, `root-directory.test.ts`); no PostgreSQL
  transaction, real MCP client or browser evidence.
- Ads (`46c6bdae`, `960831df`, `ffdb1cdf`): paused `ad.create` through shared
  management for UI, session REST and MCP, Facebook-owned transport, missing-grant
  reconnect notice and hierarchy. The former ledger CHECK gap is closed by
  `20261031180000_rebuild_ads_ad_creation` (source/checksum tests and owner-recorded
  production application). Management ships off by default. Owner now reports
  live create/rename/delete verified in Ads Manager; cleanup receipts remain open.
  Runtime locale propagation is integrated in 8d9ccbe7. Recovery authority/scope follow-up
  and residual policy distinction are detailed in round 9 below.
- Performance (`245683ce`): migration `20261031160000_rebuild_read_path_indexes`
  under root prisma/migrations adds three Posts and one Page-insights indexes;
  Analytics exact-scope read reuse/request limits, Publishing adapter reuse and
  parallel Home cards/channel histories. Source/query-shape tests only; no applied
  target receipt, EXPLAIN/volume/timing evidence or measured production gain.
- Legacy (`23b7be84`, `6ef753e4`, `b725c415`): response reports add stored root-
  comment replies/slowest and business-hour response/resolution, pre-period
  context and audited historical reopen/resolve cycles, then source-specific
  comment/conversation shares/durations and member business-hour medians. Same
  UI/REST/MCP report workflow, bilingual artifacts, unknown/zero and partial-history
  semantics; unit/mocked evidence, no complete provider history/live downloads.
- Responsive/CSS (`78493189`, `eff49d35`, `4cccd55f`): shared phone layout, border-
  box, sidebar contrast, hidden-table overflow and Home/calendar contrast fixes.
  `6fb0e57f` fixes Ads client directive and guards top-level directives.
  `36946d9e` adds missing-image fallback and saved-view expired-session feedback.
- Error pages and browser fixes (`497fda18`, `46c6bdae`): shared bilingual themed
  `ErrorState`; `error.tsx` (retry re-requests the server, way home) and
  `global-error.tsx` (layout/database failure, documented bootstrap catalog);
  queue cancel, Root activity, two-step wording, tokenless join, verify-email/
  password-recovery text and calendar badge contrast fixes
  (`tests/browser-findings-fixes.test.ts`, `tests/ui-copy-coverage.test.ts`).
  These have unit/render evidence; round 5 reran Chromium on `46c6bdae` (below).
- Round 6 (`6d3347fb`; source and unit tests with fakes, no browser, PostgreSQL,
  provider or production run):
  - Ads copy: Facebook-owned `ads-copy.ts` (EN/FR labels, name validation, confirmation
    templates) behind new Root key `meta.adsCopy` (placeholders validated); Ads
    `copy.ts` customer strings. The missing ledger CHECK at that round was closed
    in round 8; the live
    `ads_management` grant remains unverified.
  - Join: preview answers `{ invitation: null }` (200) for a missing/unknown token and
    `join-form.tsx` shows "link needed" from it (no 404; a 429 from the per-token limit
    is still possible).
  - Queue: `cancelScheduledPostAction` throws on failure instead of redirecting, so
    `CancelScheduleForm` keeps filters, reschedule input and its inline notice.
  - Recipe recovery: uncertain slots reconcile by the ledger's stored post id (never
    by channel+time; a manual post is not adopted, a cancelled post is still found,
    unknown identity stays uncertain, settlement guarded by expected post id). A
    refused pause-cancel is rotated behind untouched work (`deferCancellation`,
    least-recent-attempt order), so the earlier starvation gap is closed at unit level;
    `remaining` is no longer forced false.
  - New tests: `feeds-recipe-recovery-verification`, `publishing-scheduling-
    verification` (mixed native/app holds, stale due-worker claim, comment failure
    after confirmed publish, reschedule timeout, contributor approval),
    `facebook-ads-copy`, `browser-matrix-round5`. They are not live scheduling or
    recipe recovery evidence.

- Round 7 (`5e7749c3`; source and unit tests with fakes/mocks; schema 116):
  - Publishing findings: saved-view save without a session now says the session
    ended (`saved_sessionEnded`, EN/FR; `SavedViews.tsx` maps 401/`unauthorized`);
    published calendar posts use a dashed edge and quieter fill instead of opacity
    (the warm-light 4.35:1 "View post" finding); an unknown post id on the
    collaboration detail screen calls `notFound()`.
  - Facebook error codes/copy: `FacebookAdsValidationError` carries a stable
    `issueCode` (wording never decides behavior) and `ads-copy.ts` gains the
    validation, ownership, unconfirmed-creation/creative and transport messages
    (EN/FR), threaded as `text` through `ads-ops` and the creative executor.
    Behavior is unchanged; provider failures still do not expose raw provider text.
  - Post metric collection: `meta.postHistoryPolicy` default metrics now also request
    `post_clicks`, `post_video_views`, `post_video_view_time`; video metrics are asked
    only for positively identified video posts (status or attachments). Reactions keep
    separate observations (insight, summary edge, per-type edges) with
    `reactionProvenance` and a conflict flag instead of mixing them; lifetime
    insight responses are not paged and use the requested end as snapshot anchor.
    That round's saved-list replacement is superseded by round 9 below.
  - Reports: Published posts views (destination content log with attempt counts,
    daily UTC counts, currently failed destinations) through the existing confirmed
    UI/REST/MCP generator; new key `analytics.reports.publicationDetails`. Tests
    `report-publication-details`, `publishing-browser-findings`,
    `facebook-post-history`, `facebook-data-coverage`, `facebook-ads-copy`.
- Round 8 (`960831df`; source and unit tests with fakes/mocks; schema 117):
  - Themed 404: `src/app/not-found.tsx` renders the shared bilingual `ErrorState
    kind="not-found"` (link home, no retry); jsdom render test `not-found-page`. The
    file now exists at source; it does not give real 404 statuses to unknown
    share/bio/Root ids or add a boundary inside the shell.
  - Ads ledger: migration `20261031180000_rebuild_ads_ad_creation` (root `prisma/
    migrations`) replaces `ads_operations_operation_kind` to allow `ad.create`.
    Checks: `ads-ad-create-migration` (source/checksum), `ads-ad-create`,
    `ads-ledger74.integration`. Production application is the owner's record; it is
    not a live `ads_management` grant or a live Ads write.
  - Ads runtime copy: neutral `PlatformAdsHost.configuredOperations(locale)`;
    `platformAds(provider, locale)` returns a request-local host (no singleton
    mutation); `withPlatformAdsLocale` / `withAdsErrorBoundary(operation, locale)`
    carry EN/FR through nested calls via `server/platforms/host.ts` (AsyncLocalStorage,
    default English). A failing configured factory does not fall back to the static
    engine. **At round 8 the UI, REST and MCP entry points did not yet pass customer locale**
    (`CampaignsScreen.tsx`, `api/ads/management/route.ts`, `ads/mcp.ts`), so messages were English there (fixed in 8d9ccbe7), and recovery does not repeat the creation-only unrestricted-channel
    requirement; round 9 adds current scope/authority rechecks under lock. See `src/modules/ads/server/README.md`; test `ads-runtime-host`.
  - Facebook metric config: `FACEBOOK_METRIC_LABEL_DEFAULTS` adds Page/post/reaction
    labels; `meta.metricLabels` merges saved entries over shipped defaults so older
    stored catalogs gain new labels (`facebook-metric-config`).
  - Reports: Top posts content (destination saved text, ordered image/video refs,
    Root-switchable image previews, saved article link/title/description) through the
    same confirmed workflow; new key `analytics.reports.topPostContent` (see
    `reports/TOP_POST_CONTENT.md`); tests `report-top-post-content*`. It shows saved
    local state, not a remote snapshot.
  - Inbox/Analytics polish: focus rings, focusable labelled table regions, scroll
    limit on long channel lists, locale for "Last synced", chart wrapper, phone layout
    (`inbox-analytics-ux-polish`, source-level assertions). No browser run.
  - Root keys added in these rounds: `analytics.reports.publicationDetails` (116) and
    `analytics.reports.topPostContent` (117). This documentation lane adds none.

Round 9 (`ffdb1cdf`; source and unit/mocked/query-shape evidence; schema 118;
no fresh browser, PostgreSQL or live-provider verification by this lane):

- Ads recovery checks current account/channel visibility and independent key
  ceilings before disclosing state/confirmation, then repeats manager authority
  and account visibility under the account/ledger locks before settlement/audit.
  Creative recovery checks the exact target; retained disabled accounts do not
  need active provider grants for local attestation. Tests cover narrowed scope,
  revoked role, empty ceilings and invisible-account refusal. This closes the
  stale-authority/disclosure gap. A limited manager whose scope reaches the
  account connection is still permitted to recover ad/ad-set creations; the
  unrestricted-channel rule for creating them is not repeated. Reconcile that
  remaining policy distinction rather than claiming identical creation/recovery
  scope (see ADS_PARITY.md).
- Facebook Page presentation reads Root `meta.metricLabels` and new
  `meta.pageAnalyticsCopy` for EN/FR metric/audience labels, provenance,
  latest-per-channel/category text and overlap notes. Saved labels override
  shipped defaults, which now also include Page likes and older impressions.
  Ads/dynamic-label English literals remain; this is not full analytics copy
  extraction or provider completeness.
- Post-history metric lists now merge saved additions with shipped defaults and
  apply explicit `excludedMetrics` last (including future names). Legacy absence
  is not an exclusion. Read normalization is pure; a confirmed Root save persists
  normalized policy with the existing audit. The same Page-policy schema exists,
  but `facebook/module.ts` still registers `meta.pageInsightMetrics` as an array;
  `runtime.ts`, `adset.ts` and `ads-ops/index.ts` still consume arrays. Integrating
  that declaration and all `.metrics` projections is outstanding.
- Destinations reports add per-link lifetime inventory, retained period clicks
  and independent daily UTC retained counts through the existing confirmed
  UI/REST/MCP generator (`runReportNow`). New Root
  `analytics.reports.linkDetails` bounds link/day rows; the existing bilingual
  report-document catalog discloses clipping and retention gaps. The cohort is
  posts currently published to the selected channel within the report period,
  not clicks on every older post. Unattributed legacy links qualify only with
  exactly one published destination; ambiguous links are excluded. No visitor
  metadata, destination URL or slug is projected. Zero means no retained click
  records; lifetime counters are separate. See
  `../src/modules/analytics/reports/LINK_REPORTS.md`.
- Relevant tests: `ads-parity-management`, `facebook-page-labels`,
  `facebook-metric-config`, `facebook-analytics-selection`,
  `facebook-post-history`, `root-config-authority`, `report-link-details*`.
  No new screen, route, MCP tool or migration for these report details.

## Rounds 10–12 (HEAD `a910d774`; schema 120)

Evidence kinds are labelled per item. Nothing here is a fresh database, browser
or provider run by this documentation lane.

- **Round 10 (`75923335`, schema 119; source/unit):** Facebook Page insight
  metric resolution before transport construction
  (`configuredFacebookPageInsightMetrics`, `page-insights.ts`; the `.metrics`
  projection gap in item 7 of the next actions is not shown closed here), media
  rename REST (`/api/media-library/[id]`), feed preview disclosure and
  reviewer notices (new active key `feeds.approvalNotificationsEnabled`, default
  true; the local queued count is not SMTP delivery), Publishing/Settings
  polish, and the Published-posts weekday/hour/attempt distributions (typed fields
  inside `analytics.reports.publicationDetails`, no new key; see
  `PUBLICATION_DISTRIBUTIONS.md`).
- **Round 11 (`d6ff1f17`, schema 120; source/unit/mocked):** new Root keys
  `feeds.wordpress.reuseEnabled` (false) and `feeds.wordpress.reuseCooldownDays`
  (365) with the shared recipe supply view (details in FEEDS.md), supply card and
  warning, Ads/Home/Root polish, and `mcp-scope-feeds-service` /
  `mcp-scope-host-matrix` scoped-key tests (mocked ports; not a real MCP client).
  `RecipeSupplyCard` is built; mounting it on Home was a stated integration need.
  Confirm that mount before claiming the Home warning.
- **Live-defect fixes (source plus regression tests; fakes):**
  - `806a0ef5`: the Facebook analytics target reported the remote Page id as the
    provider id, so the host lookup failed and no channel had post performance.
    The target now reports the platform id. `6e111754`: the post explorer also
    reads synced insights for posts the application published.
  - `a47a339c`: Analytics no longer lists identifier-like metrics; the post
    explorer is lighter with local dates (`facebook-analytics-live-defects`,
    `analytics-posts-table-live-defects`). Whether production now shows post
    performance has not been observed by this lane; the owner should confirm.
- **Facebook OAuth (`c0e5386a`; source/unit):** callback checks, redirects and the
  secure state cookie use the Root public origin (`app.publicOrigin`), not
  `request.url`, which is the internal listener behind the proxy and had sent
  browsers to localhost. **Reconnect is pending the owner's retry**; there is no
  recorded successful connection after the fix.
- **Recipe captions (`a47a339c`, `a910d774`; unit/mocked):** WordPress caption
  text decodes the HTML5 named catalog and numeric references once and keeps
  U+00A0/U+202F. The caption plugin stores a C0 control (seen U+0016) where French
  typography needs U+202F, and Facebook rendered it as `0`. `stripCaptionControls`
  maps such controls before `? ! : ; »` (and after `«`) to U+202F and drops other
  C0 controls. Seven WordPress captions were affected (owner/integrator record).
  One already-published post is kept as it is; the audited preview/apply repair
  service (`caption-repair.ts`, `CAPTION_REPAIR.md`; owner/admin, dry-run receipt
  then exact confirmation, planned/never-attempted posts only) cannot and does not
  edit published content. The repair outcome for the other six is not recorded
  here: confirm each stored caption privately without logging the text. The
  independent RSS decoder in `feeds.ts` still maps `&nbsp;` to an ordinary space.
- **Browser lane, round 6 (partial; harness only):** the lane hung. `d24fcd40`
  holds the matrix script changes (WebKit on macOS uses Option+Tab so links and
  buttons are reachable; end-of-tab-order detection replaces the false "trap" in
  Firefox/WebKit headless; layout-settled focus measurement), a date/time input
  focus ring in `tokens.css` and `browser-matrix-round6` jsdom tests. No matrix
  was completed, so rounds 6–12 have no browser result and the round 5 findings
  stay unrerun. A stray local `premium-audit.json` was untracked in `7095d92b`;
  keep it out of Git.
- **Production-side facts (owner/integrator, not re-observed):** deployed
  `a910d774`, schema 120. The migration receipts and the proxy cutback gaps in
  the next actions still apply.

## Browser evidence, not an all-green gate

BROWSER_MATRIX_2026-10-21 records local production builds against a synthetic
preview PostgreSQL database; none of it is production or provider evidence.

- Chromium round 1: 992/992 cells (four themes × light/dark × desktop/phone; 41
  customer, 16 Root, five public pages); no overflow/name/theme/status failures,
  176 findings. Round 2: dynamic (160), states (176), not-found (128), empty (656),
  system (768), keyboard (656 + 672) and failure (640) cells; scoped system-mode and
  keyboard checks passed and 121 injected-failure probes preserved input/dialogs.
- Round 3: Firefox and WebKit (Safari engine, not Safari) extended matrices, 496
  cells each on vivid and warm: 43 and 99 findings, no overflow/name/theme findings,
  16 WebKit hydration warnings (`root-time.ts` "at" separator; Sharing `LinksManager`
  locale formatting, a pattern in 15 more files). Chromium system mode on every page
  (992): no mismatch or non-live cases. Database-outage 500s rendered Next's unthemed
  English page and were fixed; 0 findings in three engines using temporary app files.
- Round 4 (preview database migrated through `20261031170000`, so Feeds paths
  render): page-throw boundary 16/16 per engine with 0 findings; "Try again"
  recovery verified in Firefox only; Firefox/WebKit dynamic, session, empty,
  not-found and failure parts reproduce the module findings.

- Round 5 (Chromium only, local build of `46c6bdae`, synthetic database with Feeds
  recipe rows): full matrix 992/992 cells over 62 routes incl. Ads and Feeds, **162
  findings** (none from Ads or Feeds); fixes check 72/72 cells (0 broken images, 10
  findings); unknown route 64/64 with HTTP 404 and 0 findings. Causes: 80 seeded-media
  404s (data), tokenless `/join` 404s/429s (addressed at source by round 6), warm-light
  calendar "View post" at 4.35:1 (published-card opacity `.88`), and saved-view save
  without a session still saying "check its name" (8/8 desktop cells; Publishing
  `SavedViews.tsx`/`saved_saveFailed` unchanged). Firefox/WebKit and the dynamic/
  empty/system/keyboard/failure parts were not rerun.

Unresolved (no browser run since round 5; rounds 6–9 have source/automated changes without a browser rerun):
`not-found.tsx` exists since round 8 (unit render test) but has not been seen in a
browser; unknown bio/share/Root ids answered HTTP 200 in round 4 (the collaboration
post screen now calls `notFound()`, unit evidence); raw server text on Tasks, Labels,
Templates, Analytics goals and Inbox moderation; error boundary above the shell;
WebKit hydration; share-media 404s from seed data. Source fixes awaiting a rerun:
saved-view session wording and calendar published-card contrast (round 7), `/join`
and queue-cancel (round 6), Inbox/Analytics focus and table-region polish (round 8). `46c6bdae` fixed Root activity,
two-step wording, verify-email/recovery text at source only. Not covered: keyboard/system-mode runs in
Firefox/WebKit, all four themes there, real Safari/iOS, screen readers, long content,
client-render throws and every later merge. Read the report for exact routes/checks
rather than summing cells into a completion percentage. Historical production Chrome
and WAVE1 checks retain their dates.

## Next actions / edits outside this documentation lane

1. Fix `src/components/AppShell.tsx`: workspace selection POST must include
   exact SELECT WORKSPACE confirmation alongside workspaceId.
   Preserve selection/pending/refusal behavior; service consent must remain strict.
2. Shared config/UI owner registers `shared.formValidationCopy` using the exported
   schema/defaults in `src/lib/ui/form-validation.ts`, loads via runtimeConfig and
   serializes selected copy into FormValidation for public/auth/customer/Root
   layouts. Media presentation, loading and Root-error registrations are done.
3. Release owner reconciles actual deployed SHA/schema/migrations, confirms the
   baseline receipt in `_prisma_migrations`, and verifies CHECK/FK/identity/
   cascade/rollback probes. Preserve the one publisher policy, recovery assets
   and unresolved photo-canary lock. No replay of cutover, migration application
   or production action is authorized here.
4. Data-control owner includes ads_objects in account/workspace exports and
   retain-account erasure, with transaction/stale-sync/purge tests. See the Ads
   README and data-control README; table catalog presence alone is insufficient.
5. Ads owner records sanitized receipts for the owner-reported live
   create/rename/delete run (object levels, confirmations/audit, final state,
   cleanup and spend). Verify remaining budget/status/creative/recovery and real
   MCP paths. Review creation-only unrestricted-channel versus recovery scope;
   round 9 already rechecks current authority/visibility under lock.
6. UI owner reruns Chromium/Firefox/WebKit on synthetic data for all later merges,
   themes/viewports/FR, keyboard and failure recovery. Fix soft 404s, shell error
   boundaries, hydration and remaining raw module messages; source/DOM passes are
   not a clean browser matrix. Smoke waivers need bounded source fixes and tests.
7. Provider/Analytics owner resolves the numbers-evidence adapter gaps and Page
   metric policy registration/consumer projections. Verify database query plans,
   actual volume, worker drain timing, mixed scheduling and recipe recovery.
8. Integrator reconciles the legacy sweep and any later lane commits for
   Instagram, AI agents, async Posts CSV, design round 2 and MCP client
   execution. (Facebook Groups were dropped by owner decision 2026-10-22.)
   They must not be described as shipped/proven.
   LEGACY_CAPABILITY_PARITY ownership here permits status-cell edits only;
   adding/restructuring inventory rows requires the inventory owner.
9. Operation/module owners reconcile stale CONTRACT_AUDIT, ADS_PARITY, config
   audit and Ads handoff/README pending claims against this source snapshot.
   Documentation in this lane cannot manufacture migration or runtime receipts.

## Current lane validation

Owned: ARCHITECTURE.md, AGENT_HANDOFF.md, DELIVERY_PLAN.md, GOAL.md,
MCP_PARITY.md, LEGACY_CAPABILITY_PARITY.md status cells, FEEDS.md and append-only
RELEASE_GATES_PLAN.md. No source/UI/test/contract/registry/migration edits, new Root
keys, servers, deploy, push or production calls. Current validation results are
recorded in the appended release-gate entry; historical test counts above retain
their original scopes. Changes remain in the working tree for integration.

Fresh local checks: TypeScript zero errors; parity guard 22/22 and config validation
7/7 pass. Full suite: 618 files passed, 2 failed, 49 skipped; 8,873 tests passed,
6 failed, 2,055 skipped. Five loopback transport failures are sandbox EPERM; one
Root config search test times out (also reproduced in the focused rerun). See the
appended release-gate entry for exact commands. Full suite is not green. Git
metadata is outside writable roots, so no commit; no push is authorized here.

## Legacy shell lane q-35 — 2026-10-22

Source update: installable app shell (dynamic public branding/manifest, offline-only service worker, icons and bilingual Appearance controls), global cross-site mutation middleware and neutral likes-versus-followers growth identity are implemented in the working tree. See [PLATFORM_SHELL_Q35.md](PLATFORM_SHELL_Q35.md) for exact evidence and remaining checks. New Root key: `settings.webApp`; integrator must bump CONFIG_SCHEMA_VERSION (unchanged here). Existing `meta.metricLabels` and `analytics.overviewCopy` gain copy entries with saved-catalog compatibility. No new database table, migration, background job or provider write. Browser service workers are local browser infrastructure; existing audience synchronization stays under shared worker leases/run history. No server, deploy, commit, push or production action was authorized in this lane. These source changes do not close real browser/provider/release gates or unrelated historical gaps. Facebook Groups are dropped by owner decision 2026-10-22; historical missing-feature statements above do not authorize Groups work.

Q-35 final verification: rebuild TypeScript zero errors; PWA/parity/config 67/67 and cross-site/audience/REST-MCP/UX 242/242 pass. Required full suite: 660 passed files, 1 failed, 49 skipped (10,288 passed tests, 5 failed, 2,191 skipped); all failures are unchanged facebook-native-http loopback `listen EPERM ::1`. Build blocked by Google Fonts DNS. New checks are green, but full-suite/build/browser release gates remain open. Changes left uncommitted.

## Operator monitoring follow-up (2026-10-22)

Source adds module-owned Root monitoring (UI/REST/MCP shared authorization,
exact confirmation and audit), incident evaluation, observed-minute uptime,
and a persisted email outbox that never automatically replays uncertain sends.
The dedicated worker and independent web observer share leases/run history;
web monitoring cannot publish or write worker heartbeats. Worker failures feed
the existing scrubbed error console. Release/recovery readiness probes now use
`/api/health`; scripts were not executed against any host.

New migration `20261022180000_rebuild_uptime_samples` adds minute claims and
monitoring delivery records; apply/rehearse it before enabling monitoring.
New Root keys are listed in the operator lane verification note. Schema version
is deliberately unchanged for the integrator. Telegram, provider usage alerts,
test-alert parity and real database/browser/mail/release evidence remain open.
See `OPERATOR_MONITORING_2026-10-22.md` for scope and current verification.


Fresh operator-lane verification: `npx tsc --noEmit -p .` and
`npm run typecheck` passed with zero errors; 113 focused tests across 12 files
passed, including parity/config guards. Final full suite (only the requested
Facebook diagnostic transport exclusion, cache disabled): 658 files passed,
one failed, 49 skipped; 10,174 tests passed, five failed, 2,159 skipped. All five
failures are loopback `facebook-native-http` tests blocked by sandbox
`listen EPERM ::1`; the full suite is not green. Both release scripts pass
`bash -n`; whitespace checks pass. Work remains uncommitted as requested.

## Lane 43 follow-ups — 2026-10-22

Caption tests now accept raw caption variants through an atomic Publishing draft
batch, alongside existing-post tests. The bilingual source picker, channel
selection and exact confirmation dialog call the same caption service as REST
and MCP. Variants remain drafts until an explicit Publishing action.

Chat subscriptions receive transactional content-free workspace events through
the existing leased notifications job, with durable per-destination claims,
current workspace/access/subscription checks and no automatic replay of uncertain
sends. Root Operations owns the single installation incident evaluator and
email outbox, plus a confirmed test operation and explicitly selected
owner-workspace chat routing. The duplicate Root Alerts screen/config/tools are
removed; its old screen redirects to Operations and REST aliases delegate to the
canonical monitoring service.

Registry schema is 131. Existing caption, chat and Root monitoring policy/copy
objects gain fields; three `notifications.systemAlert*` keys are removed. The
`20261022190000_rebuild_chat_deliveries` source is squashed into the
`20261103000000_baseline` migration (lane 47). Historical
saved duplicate alert settings are not imported automatically; review the Root
monitoring thresholds and configure its chat workspace deliberately.

See [LANE_43_FOLLOWUPS.md](LANE_43_FOLLOWUPS.md) for exact verification and remaining
gates. No browser, real PostgreSQL, provider/chat/mail delivery or production
verification is claimed. Changes remain uncommitted as requested for this lane.

Final lane-43 verification: rebuild `npm run typecheck` and explicit
`npx tsc --noEmit -p .` pass with zero errors. All 22 targeted files pass
(1,019 tests). Full requested suite, cache disabled: 700 passed files, one failed,
49 skipped; 11,373 passed tests, five failed, 2,525 skipped. Only
`facebook-native-http.test.ts` fails, because sandbox localhost binding returns
`listen EPERM ::1`, matching the baseline. No claim of a green full suite.
Changes are uncommitted; migration/browser/real delivery checks remain open.

## Root administration naming lane (2026-10-22)

Root administration moved to `src/modules/root/server/admin/`; consumers and regression test names follow the new paths. Root settings are renamed to `root.admin.*`, schema 132. The idempotent `20261022200000_root_admin_settings` source (now squashed into the baseline) preserves existing canonical values. The one-time configuration importer is removed; the read-only historical migration expectations were removed with it in lane 47. Facebook live probes resolve configuration and credential decoding through the Facebook module. Stored auth hash and cookie formats remain unchanged. No server, provider call, deployment or push was run.


Root naming continuation verification: typecheck and explicit `tsc -p .` pass;
162 focused tests pass. Final cache-disabled suite (diagnostic transport excluded):
699 files pass, one fails, 49 skip; 11,370 tests pass, five fail, 2,525 skip.
Every failure is unchanged `facebook-native-http` localhost `listen EPERM ::1`.
Keep those tests intact and rerun where sockets are permitted. Migration SQL
passed a synthetic SQLite collision/idempotence/metadata check, but PostgreSQL
rehearsal and real live-probe execution remain open. No servers, deploy or push.

Root naming final continuation: module-owned probe configuration now clears bundled signing secrets when Root has none; three regression tests cover policy and credential fallback. The saved-key SQL collision/idempotence/metadata check is now an automated test (built-in SQLite, not PostgreSQL). Unused historical mapping exports and a residual plans comment are removed. Typecheck and explicit tsc pass; 10 focused files / 164 tests pass. Full cache-disabled suite excluding diagnostic transport: 701 files passed, one failed, 49 skipped; 11,374 tests passed, five failed, 2,525 skipped. All five failures are unchanged sandbox `listen EPERM ::1` in facebook-native-http. No server, live probe, database migration, deploy, push or staging was performed. Source changes remain uncommitted.

## Lane 44 sweep closure (2026-10-22)

`LEGACY_SWEEP_2026-10-21.md` section 0.4 reconciles every missing/partial row against source and lists the open items G1 to G7 (Graph usage reader, legacy `api_tokens`, seven staged connectors, text backgrounds, alt text, mail HTTP API provider, unused-media retention). New: Root key `ui.defaultLocale` (schema **133**), `scripts/install-debian.sh`, `scripts/admin/{set-root,reset-two-step}.ts` (not run on a host). Apply nothing to production from this note.


## Lane 46 OAuth connector installation — 2026-10-22

Mastodon, LinkedIn, Threads, X and Pinterest move from staged adapters to installed
module/host dispatch, disabled by default. Shared Settings/Publishing services retain
UI/REST/MCP authorization, exact confirmation and audit; OAuth uses app.publicOrigin
and discovered resources require explicit selection. G3 is done at source, with
live consent/refresh/publishing/cleanup, browser/client and release gates open.
See [CONNECTORS_LANE_46.md](CONNECTORS_LANE_46.md) for legacy credential mappings,
Mastodon single-instance limitation and the outside-owned Root manual-refresh
credential-consistency gap. Schema bump belongs to the integrator; this lane
leaves CONFIG_SCHEMA_VERSION unchanged. Final TypeScript: zero errors; 11 focused files / 183 tests pass, including
parity/config guards. Required full suite: 711 files pass, one fails, 49 skip;
11,511 tests pass, five fail, 2,553 skip. All failures are unchanged Facebook
loopback probes blocked by sandbox `listen EPERM ::1`; full suite is not green. No production
action or live-provider claim. Changes remain uncommitted as requested.

## Lane 47 legacy removal — 2026-10-22

Owner approval: "delete all old app files and doc from github and server and
cleanup the new app from any residues or old migration". Pre-removal production
backup `/var/backups/legacy-removal-202610221216`, restore verified.

Deleted from the repo (uncommitted): every tracked legacy root path (`src/`,
`tests/`, `e2e/`, `scripts/`, `docs/`, `prisma/`, `public/`, `messages/`, root
package/lock/configs, Dockerfile, compose, root README/guides). Root keeps
`rebuild/`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `.mcp.json`, `.claude/`.
Rebuild-root reads were moved first: `test-db.sh` ported to
`rebuild/scripts/dev/`, preview DB prep rewritten for the baseline, the chat
test repointed (it was the only functional root read).

Migrations: 139 rebuild + 1 root chat migration squashed into
`20261103000000_baseline` (SHA-256 `8abd5224…e0f8dd`), concatenated verbatim in
deploy ORDER. Equivalence proven by applying both chain and baseline to
scratch PostgreSQL (PGlite) and comparing full catalogs plus seed data
(identical except `CURRENT_TIMESTAMP` stamps).
`tests/baseline-migration.test.ts` pins all 140 source blocks; 27 migration
test files read the baseline via `tests/baseline-block.ts`. The rehearsal
(`cutover-rehearsal.sh`) pins and applies only the baseline to an empty
scratch DB; `prod-deploy.sh` marks the baseline applied on migrated databases
(resolve semantics) and never re-runs it there; `-1` was dropped everywhere
because the baseline contains `ALTER TYPE ... ADD VALUE`;
`install-debian.sh` uses the project's own psql ledger instead of
`prisma migrate`. Retired: `prod-cutover.sh` (one-shot, already ran),
`deploy/rebuild-deploy.sh`, `deploy/rebuild-rollback.sh` (pre-cutover blocks);
`prod-rollback-drill.sh` is rebuild-only.

Residue: `OAuthCode` export/erase hooks removed; `migration-setting-expectations.ts`
deleted (verifier keeps restore-integrity checks minus the legacy-import block);
`legacy-schema.prisma` minus five models; manifest moves 17 tables to `in_place`
and drops five retired entries; stale lane/plan docs removed
(`CLAUDE_*_COORDINATION`, `CORE_DESIGN_PLAN`, `LEGACY_COMPAT_RENAME`,
`PRODUCTION_HOST`, `plans/*`, `superpowers/plans/*`); TESTING/PREVIEW/README
rewritten for the self-contained app; OPERATIONS/CUTOVER/ARCHITECTURE/GOAL/
DELIVERY_PLAN updated. `LEGACY_CAPABILITY_PARITY.md` and the sweep stay as
historical evidence.

Server (not run): `scripts/server-legacy-cleanup.sh` (idempotent, prints what
it does) removes the old units, `/srv/ms-social-pilot{,.prev}`, the old deploy
guard, and drops `workspace_exports`, `OAuthClient`, `OAuthCode`,
`api_tokens`, `snippets` in one transaction after a fresh dump — never
`/var/lib/ms-social-pilot/media`. The literal schema-compare would have
dropped ~90 live tables (the mapped client is a partial view); the script
additionally verifies zero rebuild references and the shipped `schema.prisma`
`@@map` list server-side. Next: run it in an authorized session, then confirm
the baseline receipt and the five drops on production. No new Root keys;
schema stays 135. Full-suite/typecheck results are in the lane-47 report.
## Design v2 B4 (Inbox) (2026-10-22, source only, uncommitted)

Built per [design-v2/08-BUILD_PLAN.md](design-v2/08-BUILD_PLAN.md) B4 / [04-SCREENS.md](design-v2/04-SCREENS.md) S8. Files: `src/modules/inbox/ui/{InboxScreen,InboxChrome,InboxFilterRow,ThreadDetailsLayout,InboxActions,InboxShortcuts,moderation/ModerationScreen}.tsx`, the two inbox CSS modules, `round3-copy.ts` (`screen` block), `manifest.ts` (redirect), `src/app/inbox/rules/page.tsx` (moved from `inbox/moderation`). Deleted: `InboxFilterPanel.tsx`, the always-visible `ShortcutHint` legend. Tests: new `inbox-v2-b4`; updated `inbox-{browsing-page,round2-ui,round3-ui,screens-redesign,write-receipts-ui,thread-scroll,analytics-ux-polish}`, `instagram-customer-filters-ui`, `browser-matrix`. Evidence: unit/jsdom/server-render only; no browser, FR screenshot, keyboard-in-browser or phone-keyboard run.

- **New Root keys:** none declared. The Root-editable Inbox catalog gains entries `round3Copy.screen.*` (12 keys); the integrator may need to bump `CONFIG_SCHEMA_VERSION` if the catalog key set is versioned (unchanged here).
- **Open:** (1) moderation actions are still buttons in the thread header, not a per-message menu; (2) the sidebar channel scope is now read by the Inbox (see B5 below); (3) Saved replies are managed from the header and inserted via the existing productivity bar, not a menu inside the reply box or a phone bottom sheet; (4) BulkBar still offers its existing actions (no separate Assign); (5) the 2-tap phone path and the sticky reply box need a real phone browser; (6) legacy `scripts/verify-*` selectors for the inbox sidebar filters are not updated.

## Design v2 B5 (Insights) and Inbox channel scope (2026-10-22, source only, uncommitted)

Built per [design-v2/08-BUILD_PLAN.md](design-v2/08-BUILD_PLAN.md) B5 / [04-SCREENS.md](design-v2/04-SCREENS.md) S9 to S12. Evidence: `tsc` 0 errors; full suite (without the Facebook diagnostic transport file) green; new and updated tests `insights-overview`, `charts-v2-b5`, `inbox-scope-b5`, `route-redirects`, `analytics-explorer`, `analytics-demographics-surfaces`, `ads-filter-ui`, `module-manifests`, `shell-v2`, `browser-matrix`. **No browser, screenshot, keyboard-in-browser, FR-in-browser or screen-reader run; no server, migration, deploy or provider call.**

- **Routes (308 from the old ones, declared in the Analytics and Ads manifests):** `/insights` (Overview), `/insights/explore`, `/insights/audience`, `/insights/posts`, `/insights/compare` and `/insights/compare/ads`, `/insights/ads` (Accounts), `/insights/ads/campaigns`, `/insights/ads/manage`, `/insights/ads/analysis` (the former `/analytics/ads` ad-object analysis), `/insights/reports`, and the sub-pages `/insights/goals`, `/insights/pins`, `/insights/notes`, `/insights/tests`. `src/app/analytics/**` and `src/app/ads/**` are deleted; `src/app/insights/**` is thin re-exports. The area tabs are Overview · Explore · Audience · Posts · Compare · Ads · Reports; the pages declare `tabOrder` (new optional manifest field, honoured by `areaPages`) because two modules share the area. Goals, Pins, Ads Campaigns/Manage/Analysis and Compare ads are `navigation: false` sub-pages. The calendar-extras manifest link to chart notes now points at `/insights/notes`.
- **Overview (`ui/AnalyticsScreen.tsx`, `ui/insights/*`):** four key numbers (Audience plus three metrics picked by Root label words, see `analytics.insightsPolicy.tiles`), pinned metrics appended and hidden behind "Show all" beyond four, the main chart (metric switcher inside the card, previous period dashed, chart notes kept, horizontal scroll on phones), Top posts (ranked among the most recent measured posts by the first measure whose label matches a Root word; thumbnails are placeholders because the post read model carries no thumbnail) beside Publishing activity (counts link to Content filtered by status), goal bars when goals exist, and the former heatmap/interaction cards inside a "More insights" disclosure. Every caveat is in an ⓘ (period, coverage "x of y channels", missing is not zero, audience overlap); partial coverage turns it into ⚠. One shared header (`InsightsHeader`) carries the title, ⓘ, actions and the filter row: `DateRangePicker` with presets and the compare switch, then the page's single Filter button. All numbers come from `readAnalyticsSnapshot`, `readPinnedMetrics`, `readGoals` and `readPosts`, the same services REST and MCP use; secondary cards fail independently and are skipped when the member lacks the feature.
- **Channel scope:** Overview, Explore, Audience, Posts and the Inbox read the sidebar scope (`pageChannelScope`, `channel=a,b`, then the cookie) and turn it into the services' explicit channel filter (`insightsReadInput`); their own channel checkboxes/selects are gone. Compare keeps its own period/group forms (it compares groups, so the sidebar scope does not apply yet). Ads uses `account=` and its own Root report presets.
- **Inbox:** `ui/scope.ts` (`inboxScope`) narrows the `allowedChannelIds` constraint of `readInboxList`/`readInboxThread` to the sidebar scope, carries `channel=a,b` through links, the filter form (hidden field), paging and the progressive-load server action, and the Filter button no longer has a channel picker. A single legacy `?channel=<id>` is a one-channel scope. Synchronization from the Inbox targets the one scoped channel, otherwise all.
- **Explore (S10):** a metric list (280 px, availability dot) beside the selected metric's chart, table and resource breakdown; `?metric=` is in the address; phones show the list or the detail. Search, source and measurement type are in the Filter button. Metric links keep the page address (scope, period), not the service's canonical query.
- **Ads (S12):** `AdsHeader` (title, ⓘ, period presets from the existing `ads.reportPolicy`, ad-account switcher in the Filter button, sub-tabs Accounts · Campaigns · Manage · Analysis). **Accounts is one table** (`AccountsTable`: account, status, spend, impressions, clicks, click rate, cost per click, last synced); a row opens a side panel with the spend chart, funnel, actions and daily rows (`AccountCharts`, `DailyMetrics` reused). Spend stays per currency. "Results" and "cost per result" are provider-specific, so the table shows clicks and cost per click. Campaigns, Manage and Analysis keep their screens and Page-tools sidebars (transitional) with the new sub-tabs and routes. Ad accounts are single-select (the services take one `account`); multi-select within one currency is not built.
- **Compare:** one tool with a Channels | Ad accounts switch (`compareKindSwitch`); the two screens stay separate routes.
- **Charts (`src/components/charts`, 02 §6):** time axis fills missing days (`fillTimes`, `series-fit.ts`); comparison aligned by date offset, not array position; above two series each series gets a marker shape and line pattern; donut and stacked bars group beyond eight as "Other" (additive only; unknown stays unknown); the donut legend shows percentages; every chart has a "Show data" toggle (hidden table becomes a visible, scrollable table). `NotesTimeSeriesChart` (calendar-extras) uses the same filled axis so note marks keep their position.
- **New Root keys (integrator bumps `CONFIG_SCHEMA_VERSION`, unchanged here):** `analytics.insightsCopy` (EN/FR catalog with placeholders validated), `analytics.insightsPolicy` (period presets and default, tile definitions, tiles shown/max, chart metrics, Top posts rows/pool/ranking words, goal bars), `ads.insightsCopy` (Ads sub-tabs and Accounts table). The page labels for the tabs live in `home.shellCopy` (`ads/overview` is now "Ads", `analytics/explorer` "Explore", `analytics/ads` "Ads analysis"); saved Root edits of those entries keep their value.
- **Removed/dead:** `ui/explorer/sidebar.tsx`; the old Overview metric grid, pagination and metric-detail sidebar (metric detail now lives in Explore). `ui/AnalyticsFilters.tsx` stays (tests cover it) but no screen mounts it.
- **Open / not done:** (1) no browser, FR, keyboard, contrast or screenshot evidence, and the Overview height (at most 1,800 px) and phone priority 4 (2×2 tiles, bottom-sheet ⓘ, scrollable chart) are CSS/DOM only; (2) Reports, Goals, Pins, Campaigns, Manage, Analysis, Compare and Audience keep their sidebar Page-tools forms rather than the header Filter button; (3) Posts has the sidebar form and no SidePanel with metrics; (4) Top posts thumbnails are empty placeholders until the post performance read model exposes media; (5) Ads Accounts has no "results"/"cost per result" columns and no multi-account select; (6) Compare with the sidebar scope; (7) legacy `scripts/verify-*` selectors for the old Analytics/Ads sidebars are not updated (the matrix route lists are); (8) `SidebarDock` and the Page tools adapter stay until B9.

## Design v2 B6 (Settings) (2026-10-22, source only, uncommitted)

Built per [design-v2/08-BUILD_PLAN.md](design-v2/08-BUILD_PLAN.md) B6 / [04-SCREENS.md](design-v2/04-SCREENS.md) S13. Evidence: `tsc` 0 errors; full suite (without the Facebook diagnostic transport file) green; new and updated tests `settings-v2-b6`, `workspace-operations-shortener-ui` (rewritten for the cards), `settings-form-validation`, `settings-round2-ui`, `module-manifests`, `browser-matrix`, `integrations-module`, `client-sharing-host79`. **No browser, screenshot, keyboard-in-browser, FR-in-browser or screen-reader run; no server, migration, deploy or provider call.** Services, REST and MCP are unchanged.

- **Shell:** for the Settings area `AppShell` renders an in-content section list (220 px left on desktop, a scrolling strip below 860 px) instead of area tabs. Sections come from the manifest (`tabOrder`): Workspace, Channels, Team, Sharing, Integrations, Account, Data and privacy, History. Labels come from `home.shellCopy` page titles (`settings/connections` is now "Channels", `settings/sharing` "Sharing", `settings/mcp` "Integrations").
- **Routes (308 from the old ones, declared in the Settings manifest):** `/settings/channels` (+ `/groups`), `/settings/sharing` (+ `/bio`), `/settings/integrations` (+ `/keys`, `/webhooks`), `/settings/account` (+ `/security`, `/appearance`, `/notifications`, `/notifications/chat-channels`). Page ids and permissions are unchanged; Link in bio, Webhooks, Notifications and Appearance are `navigation: false` tabs. `/settings/profiles/operations` keeps its address (API). Section tabs: `ui/section-tabs.ts`, rendered by `SettingsPage tab=...` (`SectionTabs`).
- **Workspace (`ui/workspace/WorkspaceCards.tsx`):** seven cards (Name and time zone with a searchable time-zone `Select`, Approvals, Posting hours, Queue and spacing, Links with UTM under a disclosure, AI voice, Moderation alerts). Each card saves alone with its own Save, a "Saved" toast and an inline error that keeps the edit. Cards send their fields on top of the last saved state through the existing `workspace/policy` and `workspace/operations` endpoints with the same exact confirmation strings (the extra confirmation dialog was dropped). The workspace name is read-only (there is no customer rename service).
- **Channels:** one card per connected account (avatar, name, status pill, "x of y channels in use", missing permissions in red with the full grouped list on demand, [Manage channels] [Reconnect] and "⋯" Disconnect). Disconnect keeps its retain-or-delete dialog and consequences. Ad accounts table without the account id column; groups and labels are the second tab. The ad-account id line was removed from the selection dialog.
- **Account:** Profile (name, workspace context without the slug), Security (password, sessions, two-step, passkeys), Appearance, Notifications. The partial account export moved to Data and privacy. Personal (Agency) keys moved to Integrations › API keys; the Account-only fallback still applies. The session id no longer appears in the sign-out confirmation.
- **New Root key (integrator bumps `CONFIG_SCHEMA_VERSION`, unchanged here):** `settings.sectionsCopy` (EN/FR tab, card and Channels labels). Page titles live in the existing `home.shellCopy`.
- **Open / not done:** (1) no browser, FR, keyboard, contrast or screenshot evidence; (2) phone shows a scrolling strip, not the "list page then section page" flow; (3) Team, Sharing, Integrations (MCP, webhooks) and Data keep their earlier panels, only wrapped in the new frame and tabs, and still use the old button styles; (4) no workspace rename; (5) Data and privacy has no unified ZIP status card beyond the existing export panel; (6) legacy `scripts/verify-*` selectors for the old Settings pages are not updated.

## Legacy server removal executed (2026-10-22)

`scripts/server-legacy-cleanup.sh` ran once on production and was then deleted from the repository; references to it above are historical. Result: fresh backup `/var/backups/legacy-cleanup-20261022110559`, five unmapped tables dropped (workspace_exports had 1 row; others empty), legacy units, `/srv/ms-social-pilot{,.prev}` and `/usr/local/sbin/socialpilot-deploy` removed; rebuild units stayed active. Production then deployed `b9001ddf` with the baseline marked applied. `20261022200000_root_admin_settings` was never applied in production before the squash; production had no `root.legacy.*` keys, so no data changed.


## Design v2 B7 — lane 55 (2026-10-22, partial, uncommitted)

Read [design-v2/B7_IMPLEMENTATION.md](design-v2/B7_IMPLEMENTATION.md) before
continuing. Owned Home/Tasks/Agency UI and tests are changed; no new Root keys,
registry bump or service behavior. Home has first-run replacement, personal
greeting, compact period, InfoTip caveats, scheduled-post ListRows, real nonzero
Inbox attention and per-card refresh. Tasks/Agency filters no longer use the dock;
Tasks uses tabs/SidePanel, guards stale comment reads and pending competing actions.
Agency retains its scoped table/unknown values, confirmed switch and exports.
Full S1/S14 is not complete; outside-owned data/copy/activation and build/browser
blockers are enumerated in the report. Synthetic component fixtures are optional
file-only exports, not screenshots or actual page verification. Leave uncommitted;
no server, deploy, push or production work was authorized in this lane.

Final lane-55 evidence: TypeScript exit 0 / zero errors; 16 focused files,
223 tests passed (3 optional artifact-export tests skipped). Full suite with
only diagnostic transport excluded: 718 files passed, 1 failed, 49 skipped;
11,609 tests passed, 5 failed, 2,556 skipped. The failures are unchanged
`facebook-native-http` sandbox `listen EPERM ::1`. Build fails on font DNS and
an outside-owned Settings/Sharing client import of server-only code. Chrome
launch was sandbox-blocked; no screenshots. `git diff --check` passes.

## Design v2 B8 — lane 56 (2026-10-22, uncommitted, source/unit/jsdom only)

Implements batch B8 (S15 Root) and finishes the B7 outside-owned leftovers 1–4
(Home attention/link-click/recent-Inbox data and copy, Agency waiting counts,
optional-area activation, per-task checklists). B7 leftover 5 (Settings/Sharing
production build chain) was already fixed on `main` (`b2ac77b2`); leftover 6
(integration environment) is unchanged: this lane ran unit/jsdom only.

Root: sidebar regrouped into Overview/People/Modules/Operations/Activity with
area icons; module detail pages split into Settings·Availability·Diagnostics·Health
tabs (platforms omit Availability); Operations into Jobs·Diagnostics; Shared
configuration into Settings·Availability. All routes kept. Moved
`src/server/root/*.tsx`, `src/server/jobs/RootJobHealth.tsx` and
`src/app/root/root-nav-icons.tsx` into `src/modules/root/ui/` (no outside-owned
importer needed a shim). The move put 128 pre-existing Root operator literals
under `tests/ui-copy-coverage.test.ts`; they are now catalogued in
`root.interfaceCopy` (EN/FR) with `useRootInterface()` (client) and a cached
`loadRootInterfaceCopy()` (server); only the `ms` unit is allowlisted.

Services: Home overview gains attention counts, link-click totals from the
snapshot metric, an audience delta between known trend days, recent open
conversations, non-throwing setup and a `channelIds` display filter through
UI/REST/MCP. Agency gains an `inbox` capability group (waiting conversations
with coverage) in the overview and exports, plus a clarified `channel` parameter
on Agency/Clients. `workspaces.tasksAreaEnabled` (migration
`20261103020000_workspace_tasks_area`) lets Settings › Workspace show Tasks
early through the existing workspace-operations service; Agency appears for
>1 administered workspace; Tasks obeys the scope through linked posts and
reports hidden unlinked tasks. Per-task checklists: new `task_checklist_items`
table (migration `20261103010000_task_checklist_items`), confirmed/audited
service actions, UI/REST/MCP and Root limits. New MCP tools:
`add_task_checklist_item`, `set_task_checklist_item`,
`delete_task_checklist_item` (parity rows added). New Root keys (integrator
bumps `CONFIG_SCHEMA_VERSION`): `home.linkClickMeasureWords`,
`home.recentInboxLimit`, `home.recentInboxPreviewCharacters`,
`home.attentionReconnectLimit`, `tasks.checklistLimit`,
`tasks.checklistItemMaxCharacters`.

Evidence: `npx tsc --noEmit -p .` 0 errors; `npx next build` passes;
`npx vitest run --exclude "**/facebook-diagnostic-transport.test.ts"`: 720 files
passed, 11683 tests passed, 5 failed — all 5 are the pre-existing
`tests/facebook-native-http.test.ts` sandbox `listen EPERM ::1` failures (same
as B7). Agency module suite: 183 passed; 7 failed, all verified pre-existing on
the clean tree (`export-ui` ×3, `person-account` ×2, `person-ui` ×2). No browser
run, screenshots, live-provider or production verification.

## Design v2 B9 (2026-10-22, source/unit/jsdom only; see HANDOVER for the ship record)

Built per [design-v2/08-BUILD_PLAN.md](design-v2/08-BUILD_PLAN.md) B9 plus the
three HANDOVER open items it names (data-deletion catalog, atomic token
refresh, Inbox saved-replies menu + bulk Assign). Closes the B4 open items
(3) reply-box menu and (4) bulk Assign, and the B2/B3/B5/B6 open items on
`scripts/verify-*` selectors.

- **Adapter removal:** deleted `src/components/SidebarDock.tsx` and the
  unmounted `ModeToggle.tsx`; `AppShell` loses the Page tools sheet, toggle
  and context; `PageFrame`, shell copy/CSS, Root, Calendar, Reports, Ads and
  Analytics screens drop dock mounts. `sidebar=` hits 0 and `pageTools` hits
  0 in `src/`. Eight verify scripts rewritten for the new selectors
  (browser-matrix, first-comments94, destination-formats85,
  facebook-native-journal89/policy87/status91/publication-submissions92,
  reports82); selectors are source-verified only, no browser run.
- **Data deletion:** outcome sentences move from a code constant into
  `public.content` (`resultCompletedOne/Many` with required `{count}`/
  `{when}`, `resultUnknown`, `resultInvalid`; EN/FR defaults;
  `resolveDataDeletionResults` backfills catalogs saved before the keys).
  New `tests/public-data-deletion.test.ts`; `server/site.ts` untouched.
- **Token refresh:** `root/server/admin/connection-refresh.ts` renews the
  account token, `tokenExpiresAt`, destination copies and audit in one
  `prisma.$transaction`. New host fields `grantExpiresAt` and
  `rotateDestinationCopies`, declared per module (YouTube, TikTok, LinkedIn,
  Pinterest, Threads, X); Facebook/Mastodon untouched (page-specific
  grants). New `tests/root-connection-refresh-atomicity.test.ts`; mocked
  transport only, no live-provider renewal run.
- **Inbox:** `ReplyBox` gains an `onInsertSavedReply` menu (names from the
  saved-replies service; insert fills the draft, never sends;
  loading/error/empty/disabled states; writers only). `BULK_ACTIONS` gains
  `assign` (conversations/comments only, `assigneeId` member or null,
  `BULK_INVERSE` null — no Undo) through the shared service with UI dialog
  (member picker from the first item's team list), REST and `bulk_inbox_action`
  parity, exact `BULK ASSIGN <n> INBOX ITEMS TO <member|UNASSIGNED>`
  confirmation and audited receipt. New `tests/inbox-bulk-assign-mcp.test.ts`
  and `tests/inbox-reply-saved-menu.test.ts`. Closes B4 (3)(4).
- **Integrator fixes:** `CONFIG_SCHEMA_VERSION` 135 → **136** (queued B8 keys
  plus the three B9 catalog changes; `config-validation` pins updated).
  `tsconfig.json` excludes reference-only `docs/handover/archive`, whose
  73-file WIP backup broke typecheck (103 errors) and the `next build` type
  gate at HEAD; nothing imports it. Saved `home.shellCopy` catalogs carrying
  `pageTools` keys read as the shipped default until re-saved in Root.

Evidence: `npm run typecheck` 0 errors; targeted B9 files pass; full suite
(diagnostic transport excluded, 30 s timeout) 724 files / 11,726 tests
passed, 5 failed — all pre-existing `tests/facebook-native-http.test.ts`
sandbox `listen EPERM ::1` (file untouched by B9; `node:net` `::1` bind
probe fails identically). `npx next build` re-run at ship time. No browser
matrix, keyboard walk, live-provider or production-behavior run in this
batch beyond the deploy health checks; see HANDOVER for the ship record.

## Ads area split — 2026-10-22 (source/unit only, uncommitted)

Owner decision (authoritative): Ads insights and management move out of
Insights into their own top-level **Ads** area with area tabs Accounts,
Campaigns, Manage, Analysis, Compare. Canonical routes are `/ads`,
`/ads/campaigns`, `/ads/manage`, `/ads/analysis`, `/ads/compare` (moved with
`git mv` under `src/app/ads/`, new `src/app/ads/layout.tsx` owns the ads.css
import); old `/insights/ads*` and `/insights/compare/ads` redirect with 308
via manifest declarations, plus the `/ads/objects` → `/ads/manage` alias. No
reverse `/ads` → `/insights/*` entries (they would loop).

- Plumbing: `AreaId` gains `'ads'`; `ModulePageManifest` gains the optional
  per-page `area` override (lets `analytics/ads` join the Ads area);
  `AREA_ORDER` inserts `ads` after `insights`; `AppShell` gains the
  `AREA_GLYPH` entry (existing `ads` registry id) and `FIXED_AREAS` entry;
  phone bar order is Home, Content, Inbox, Create, Insights, Ads;
  `--area-ads` token plus shell.css glyph rule added.
- Chrome: `SHELL_COPY` areas gain `ads` (EN `Ads`, FR `Publicités`);
  pageTitles become Accounts/Comptes, Campaigns/Campagnes (kept),
  Manage/Gérer, Compare/Comparer. Old saved catalogs backfill from shipped
  text (covered by a new shell-v2 assertion).
- Headers: `AdsSubTabs` deleted (area tabs carry navigation);
  `AdsHeader`/`adsHeaderFor` keep title, ⓘ, period and account controls;
  `compareKindSwitch` (Channels | Ad accounts) kept with updated hrefs;
  pager/export placement unchanged.
- `CONFIG_SCHEMA_VERSION` 136 → **137** (`config-validation` pins updated).

Evidence: `npm run typecheck` 0 errors; 11 touched test files plus 15
neighboring ads UI files pass (see batch notes for the file list). The
verifier owns the full suite. No commit, push, deploy or server run in this
lane. Next: full-suite verification, browser-matrix v2 run (families now
include `/ads`; cell counts updated), then release through
`rebuild/scripts/prod-deploy.sh` per CUTOVER.

## Desktop UX organization — 2026-10-22 (no commit/push/deploy)

Owner directive DESKTOP FIRST (organization, not styling). Audit:
`docs/UX_NAVIGATION_AUDIT.md` (new, dated) with the full click-depth table.
Feeds was buried at /content/library/feeds (depth 3); AI studio, caption
tests and chart notes were reachable only by URL.

- Feeds → own Content tab at /content/feeds (308 from /content/library/feeds
  and /publishing/feeds); own PageHeader; pagination updated; removed from
  Library sections.
- AI studio → own Content tab (new `publishing/ai-studio` feature); page
  gating moved to it; no-channel empty state links to /settings/channels (new
  `noChannelsAction` key in Root catalog `ai.toolsCopy`, schema derived, no
  version bump).
- Caption tests → own Insights tab (new `analytics/tests` feature, tabOrder 45;
  `tabRoutes` on Posts removed); page gating moved to it; client role keeps
  analytics parity.
- Chart notes → linked from Insights Overview header via `calendarExtrasLinks`
  (Root-managed label, no new copy).
- Switch maps (`FEATURE_ROOT_SWITCH`, `FEATURE_MODULE_SWITCH`), shellCopy
  pageTitles EN/FR, PAGE_ICONS, command palette (automatic) updated. No
  CONFIG_SCHEMA_VERSION bump (config-validation passes; no new registry keys).
- Mobile work explicitly NOT started (later child owns it).

Evidence: `npm run typecheck` 0 errors; 15 touched/adjacent files pass
(route-redirects, app-shell, shell-v2, content-v2, content-v2-server,
module-manifests, feeds-mcp, command-palette, mcp-security,
ai-content-tools-ui, ai-content-tools-http, config-validation,
contract-audit-shell, smoke-guard-redirect, caption-tests-service).
No browser run; full suite owned by the verifier. Next: mobile pass, then
browser-matrix v2 run and release per CUTOVER.

## Planned-vs-published surfacing — 2026-10-22 (no commit/push/deploy)

Owner directive (authoritative): content planned vs published must be
clear. Surfacing/UX batch, no remodel: PostStatus unchanged; Planned =
draft/pending_approval/scheduled/publishing, Outcome = published +
partially_failed/failed/cancelled/rejected (`src/lib/post-groups.ts`).

- Posts: status filter grouped into Planned/Outcome optgroups (values
  unchanged); row chips carry `data-group` (dashed outline = outcome) on
  desktop and phone; header says "X planned · Y published" (FR "X
  prévues · Y publiées") over the list scope minus the status filter.
- Calendar: month/week cards and the phone agenda share the solid-edge
  (planned) vs dashed-edge (outcome) rule with a small legend; toolbar
  shows the range counts; status filter grouped the same way.
- Queue: header pairs the scheduled total with the published count; a
  Sent block links sent/failed posts under Posts (only when any exist);
  empty states still name the next action.
- New `readPublishingStatusCounts` service (planned/published/failed)
  reuses the shared scoped query; new strings live in the existing
  `publishing.uiCopy` catalog (schema derived, no registry change).
- Home verified unchanged: it renders no mixed planned/published count
  (upcoming is scheduled-only; attention rows are per-state).
- Honesty preserved: post-level status distinct from per-destination
  outcomes; no new success claims. No CONFIG_SCHEMA_VERSION bump
  (config-validation pins 137 and passes; copy-only catalog growth).

Evidence: `npm run typecheck` 0 errors; 6 files pass (content-v2,
content-v2-server, calendar-board-ui, publishing-customer-copy,
publishing-read-service, config-validation). No browser run; full suite
owned by the verifier. Next: browser-matrix v2 run and release per
CUTOVER.

## 2026-10-22 — Insights excellence pass (child batch, source only)

Owner directive: improve Insights organization, completeness, usability
(desktop-first, then phone). No URL moves; no Root registry changes.

- Palette reaches every Insights page: new `palette` page flag
  (`src/modules/types.ts`, `src/lib/product.ts`); `listNavigationCommands`
  includes `navigation:false` pages flagged `palette:true`. Goals/pins
  flagged; new `analytics/notes` page (Chart notes, `/insights/notes`,
  same `analytics/overview` switches in entitlements + permissions).
  Tabs unchanged (goals/pins/notes stay sub-pages).
- Explore detail states coverage, freshness ("Latest stored measurement
  as of …", Unknown when none) and the comparison range; list greys out
  zero-coverage metrics with the "No data stored" reason. New workspace
  copy key EN+FR (schema derived, no registry change).
- Compare header states the comparison basis (both periods + channel
  count, or group sizes + shared period). Semantics unchanged
  (currency refused, reach caveat blocks group deltas, coverage-gated).
- Fixed stale `/analytics/explorer` empty-state link → `/insights/explore`.
- Phone: chip removal, chart metric tabs and the compare kind switch
  reach 40px on coarse pointers (analytics CSS only; shared controls
  already bump via tokens).
- No CONFIG_SCHEMA_VERSION bump (no registry entries added or changed;
  config-validation 9/9 passes).

Evidence: `npm run typecheck` 0 errors; 9 files pass
(command-palette, command-palette-ui, module-manifests,
analytics-explorer, analytics-explorer-views-ui,
insights-compare-screen (new), mcp-security, analytics-copy,
config-validation). No browser, provider or production run. Open: true
provider-withdrawn vs never-collected metric distinction (needs loader
support); browser/theme/phone verification of the new lines.

## Excellence pass: Inbox, Publishing depth, Home, Tasks, Agency, Settings (2026-10-22, source/unit only, uncommitted)

Owner directive: improve all modules. This batch covers the six remaining modules (Ads, AI Studio, Feeds, Insights, planned-vs-published shipped earlier; Root out of scope). Fixes are verified in source with unit/jsdom/server-render tests; no browser, provider, migration, deploy or production run.

- **Agency:** fixed a shadowed `scope` variable that rendered the "channel scope does not filter it" notice on every visit; it now shows only with a `channel` parameter (`AgencyScreen.tsx`, `agency-shared-screen`).
- **Palette:** `palette: true` for the seven tab-hidden sub-pages (Library Fields/Labels/Templates; Settings Link in bio/Notifications/Appearance; Webhooks), matching the Analytics goals/pins/notes pattern (`command-palette`).
- **Library:** Media tiles open a detail sheet (`SidePanel`, full page on phones) from existing list data — preview, facts, post links, honest capped-holder counts, rename/delete entry points. Eight new EN/FR `media.copy` keys fill from shipped defaults so saved catalogs keep validating (`media-round11-ui`, `media-library-module`, `ui-copy-coverage`).
- **Create:** More options gains a label selector fed by `readLabelPage` (all pages); the save path already accepts and validates `labelId`. Template labels the workspace no longer has are dropped instead of submitted. Two new EN/FR `publishing.contentCopy` keys (`post-composer-ui`).
- **Inbox:** resolve/reopen (single and bulk share `setInboxWorkflowResolved`) now also writes `activity_logs`, so Settings › History shows them with six new EN/FR action labels; Root `root_activities` rows are unchanged (`inbox-workflow`, `inbox-workflow.integration` assertions, `public-site`).
- **Verified, no change:** Home attention/KPI links all land on working scoped screens with InfoTip honesty; Tasks board/table/workflows/checklists/comments end-to-end with empty states and phone stacking; Agency waiting-conversations metric with inbox coverage exists in service and UI; Settings `/settings/channels` rename consistent (only the manifest 308, feature ids and API route keep old names by design), token health/expiry/missing grants shown, disconnect keeps retain-or-delete with preview and exact confirmation; Inbox shortcuts dialog, bulk assign, validated sync counts/times; approvals A/R keys documented in-UI; team invitations exist (`InvitationControls` — the old "not implemented" note is stale); `DataTable` stacks on phones by default.
- **Left open (need new/extended services, never stubbed):** per-channel text overrides (no service; `PostTarget` carries only format/schedule overrides); Posts date-range/label filters (`readPublishingPostPage` lacks from/to/labelId — MCP list has from/to); custom-field values at create time (create accepts none); palette entries for tab routes without feature ids (Inbox Rules, API keys, Security, channel groups); reply/hide/delete customer history rows; B4 moderation per-message menu and reply-box saved-replies menu.
- **Docs:** UX-CONTRACT.md rules, this entry, ARCHITECTURE.md status note. No `CONFIG_SCHEMA_VERSION` bump: no registry entries added (config-validation passes at 137; `media.copy` new keys default-fill, `publishing.contentCopy` falls back wholesale on old saves).

Evidence: `npm run typecheck` 0 errors; touched suites pass (list in the ARCHITECTURE.md note). No full suite (not run per batch instructions), no browser, no provider, no production verification.

## Inbox message vs comment surfacing — 2026-10-22 (source/unit only, uncommitted)

Owner directive: inbox message vs comment must be unmistakable. Surfacing/UX batch, no remodel, no URL/route changes.

- Separate lists: `InboxScreen` coerces absent/legacy-`all` kind to `message`; `InboxFilterRow` Type offers only message/comment/review; a kind switcher (`kindTabs`) shows per-kind totals + message unread and keeps sidebar channel scope and all other filters on switch.
- Rows: `data-group` edge (solid message / dashed comment / dotted review) + icon + label; reviews get a star icon (`InboxTag` `review`). Thread head has an audience line; `ReplyBox` states private/public reply consequence; comment `ThreadToolbar` states the hide consequence.
- Service: `readInboxList` returns optional `totals`/`unread` (`InboxKindCounts`, kind filter ignored) via grouped count + message unread sum; `inboxKindCounts` folds grouped rows. API/MCP still accept `kind: 'all'`.
- Copy: 15 new EN/FR keys across `inboxCopy` (incl. `audiencePrivate` template), `REPLY_COPY`, `actionCopy`, `reviewCopy`, all in the existing `inbox.customerCopy` catalog. No sidebar inbox badge exists, so no badge change. No `CONFIG_SCHEMA_VERSION` bump: no registry entries added or changed (config-validation passes at 137).
- Empty states per kind with kind-preserving next actions; list titles are kind + state ("Messages · Open").

Evidence: `npm run typecheck` 0 errors; new suites pass (inbox-kind-separation 10, inbox-kind-consequences 2); touched/neighbor suites pass (inbox-browsing-page, inbox-round2-ui, inbox-round3-ui, inbox-customer-copy, inbox-scope-b5, inbox-write-receipts-ui, inbox-delete-ui, inbox-delete-recovery-ui, inbox-v2-b4, inbox-screens-redesign, inbox-mention-ui, inbox-reply-saved-menu, inbox-nested-replies, inbox-thread-scroll, inbox-progressive-list, inbox-state-isolation, inbox-reviews, inbox-reviews-read, inbox-round3, inbox-read-routes, inbox-actions-route, inbox-route-auth, inbox-key-scope80, ui-copy-coverage, config-validation). No full suite, browser, provider or production verification in this batch.

## Instagram live-ready lane — 2026-10-22 (source/unit only, uncommitted)

Owner directive: Instagram goes live first. No live Graph calls from this lane
(sandbox has no loopback/tokens); live steps are owner-executed from the new
checklist. The module stays installed but disabled by default.

- **Audit:** `docs/INSTAGRAM_LIVE_RUN.md` §1 classifies every capability
  (implemented/partial/missing with file paths); §2 is the exact
  owner-executed checklist (connect, photo/video/reel/story, schedule, first
  comment, inbox reply, insights compare, token drill, cleanup); §3 lists open
  live gates.
- **Implemented:** feed-video (`VIDEO`) and story (`STORIES`, caption refused,
  no first comment/status) formats complete the publishing matrix
  (`publishing.ts`, `adapter.ts`, `config.ts` copy); post-metric defaults gain
  likes/comments/shares; new `insights.ts` `media()` collector (bounded
  window, per-media isolation, clipped-window refusal) persisted to
  `instagram_media` by `syncInstagramAnalytics`, feeding `postPerformance`;
  `instagramPublicationRecovery` registered in the shared recovery registry
  (the documented before-activation gap — installed even while off).
- **Still missing (do not promise):** inbox background sync, DMs, Meta inbound
  webhooks, remote media deletion, signed local-media delivery
  (Publishing/media pipeline owner), Graph usage-header accounting.
- **Safety:** no top-level Root keys (nested `instagram.policy` additions
  only), no Facebook login/scope change, no grant regression; scopes checked
  against stored Page grants, never added to the login dialog.
- **Docs:** this entry, `ARCHITECTURE.md` status note, `OPERATIONS.md`
  Instagram runbook section, `LEGACY_CAPABILITY_PARITY.md` Instagram cells,
  `MCP_PARITY.md` shared-entry mapping note, `DELIVERY_PLAN.md` row 8 fix,
  module `README.md` addendum. No `CONFIG_SCHEMA_VERSION` bump: no registry
  entries added (config-validation passes at 137).

Evidence: `npm run typecheck` 0 errors; 13 suites / 144 tests pass
(instagram-platform, instagram-jobs, instagram-container-recovery,
instagram-hosts, instagram-host-connection, instagram-runtime,
instagram-selection, instagram-source-binding, instagram-discovery,
instagram-container-journal, instagram-customer-filters-ui,
config-validation, publication-remote-projection). No full suite (not run per
batch instructions), no browser, no provider, no production verification.

## 2026-10-23 UX gaps batch 1 (uncommitted when written)
Owner-reported weaknesses, verified in source: inbox comment rows never rendered
the fetched origin-post text; posts list had no reach column; post rows opened
the side panel instead of detail. Fixes: `InboxListRows.tsx` renders the origin
excerpt (`On your post`, existing EN+FR key) and a `commentNoText` fallback for
empty comments; new `publishing/server/post-reach.ts` sums stored per-post reach
from `post_targets.insights` with the `external_posts` fallback (stored data
only, fail-soft empty map); `PostsTable.tsx` gains an end-aligned Reach column
(+ phone meta) and row click navigates to `/content/post/[id]` while the preview
button keeps the side panel. Copy: `columnReach`/`reachUnavailable` EN+FR in
publishing kit catalog. No registry/migration/route change; schema stays 142.

Evidence: `npm run typecheck` 0 errors; new `content-ux-gaps-posts` (4) +
`content-ux-gaps-inbox` (4) pass; neighbors `publishing-ui-round2`,
`content-v2`, `content-catalog-merge`, `inbox-sync-freshness` pass (59 tests).
No browser run (matrix needs a --yolo relaunch); deploy pending same.

## 2026-10-23 UX gaps batch 2
Dead-row hunt across 48 DataTable call sites: notification titles never linked
anywhere although rows carry post/channel ids; ads hierarchy names were plain
text although the row menu already filtered the objects manager. Fixes:
`notificationHref` maps post kinds to the post page, connection kinds to
/settings/channels, metric/report kinds to /insights/reports, triage to /tasks,
queue_empty to the channel content list and other channel kinds to the inbox;
titles link only when the source is still available and the id is safe, else
plain text. `HierarchyTable` names link to the same filtered manager URL as the
row menu. No copy/registry/migration/route change.

Evidence: `npm run typecheck` 0 errors; new `content-ux-gaps-links` (5) pass;
neighbors `notifications-engagement-ui`, `ads-manage-tabs-ui` pass. No browser
run; deploy pending --yolo relaunch.

## 2026-10-23 UX gaps batch 3
Dead post references: task cards showed the linked post preview without a link;
the open comment thread showed the origin post text without a link. Fixes:
`TaskBoard` post preview links to the post detail page (id already on
`TaskView.post`); `OpenThread` gains `postId` (one added select in the comment
thread query, null for messages/reviews) and `InboxScreen` renders an `openPost`
link (new EN+FR key) beside the origin excerpt. No registry/migration change.

Evidence: `npm run typecheck` 0 errors; extended `tasks76-ui` +1 and
`inbox-round3-ui` +1, both suites fully green (46 pass, 1 skip). No browser
run; deploy pending --yolo relaunch.

## 2026-10-23 UX gaps batch 4
Unclear-state hunt: a sync that hit paging bounds recorded `incompleteTargetIds`
in the audit but the inbox still claimed "Synced X ago" with no warning.
Fixes: `syncIncompleteFromAudit` (pure, tested) reads the latest overlapping
`inbox.synced` audit; `InboxListPage.syncIncomplete` carries it; the sync bar
shows a `partialNote` warning badge (new EN+FR key) for stored partial data and
for a just-completed sync reporting `incompleteCount` (now accumulated in the
multi-provider totals and declared optional on the host interface). Also
documented the staging boundary in `staging.ts`: reads, enabling token
refreshes and worker AI classification intentionally keep running under dry-run
(they dispatch nothing outward); only the outward dispatches stay silent.
Recon verdicts: lastSynced MAX/null semantics sound; Telegram publish + team
chat already dry-run gated; Facebook inbox uses full rescan + incomplete
tracking (no cursor) by design.

Evidence: `npm run typecheck` 0 errors; extended `inbox-sync-freshness` (+4)
and `inbox-round3-ui` green (45 pass). No browser run; deploy pending
--yolo relaunch.

## 2026-10-23 UX gaps batch 5
Calendar event preview dialog showed the full post with only a Close action and
no path to the post. Fix: the dialog actions gain an "Open details" link
(existing EN+FR `openDetails` key) to `/content/post/[id]`. Hunt notes: media
library tiles already open a detail panel; home, studio agents, analytics
cards, approvals cards and the posts search are already linked; compare rows
and creative rows are honestly dead (aggregates/remote picker data).

Evidence: `npm run typecheck` 0 errors; extended `calendar-wave2-ui` +1, suite
green (6 pass). No browser run; deploy pending --yolo relaunch.

## 2026-10-23 UX gaps batches 6-11
Batch 6 (5dd45cae): exact draft/approved totals. Batch 7 (72730698):
explorer internal post links. Batch 8 (1e46216e): dry-run email
suppression (outward dispatches stay silent, rows stay pending). Batch 9
(061ba36b): creatives title/body + copy-id. Batch 10 (707708ae): inbox
origin-post link. Batch 11 (2f20e94d): unconditional `/content/post/*`
cross-link convention (post page re-checks scope). Full suite green
(779 files, 12296 passed). Batch 4 caused one query-budget regression,
fixed (542b3c89) and re-verified.

Evidence: full vitest suite green; typecheck 0 errors. Deployed via
prod-deploy.sh (DEPLOY OK). V2 browser matrix 544/544 triaged on
preview :3200 (fresh QA DB, localhost not 127.0.0.1).

## 2026-10-24 batch 12: matrix overflow fixes (e1a9041d)
Constrained tab strips, pins bar, compare top and queue slot row.
Browser-verified 0px overflow. Pushed, deployed with batch 13.

## 2026-10-24 batch 13: analytics window-abort fix (5b1423ae)
Post-history sync aborted mid-window discarded already-fetched
observations. Fix persists insights incrementally; mutation-proven
(test fails pre-fix). Production 01:15 UTC run: failed 10 -> 6,
updated=324 persisted (was updated=0 on the 23:15 run). Residual
failed=6 needs per-item diagnosis at the 02:15 run (watch worker log).

## 2026-10-24 batch 14: QA rebuild script (df45f34c)
`scripts/dev/qa-db.sh` rebuilds the QA Postgres database (migrations +
seed) after drift (missing `_prisma_migrations`, missing tables);
`db_sql` closes stdin so loops calling it are not eaten. Docs fixed
(PREVIEW/OPERATIONS/ARCHITECTURE referenced the old flow).

## 2026-10-24 batch 15: scheduler starvation fix (a826eb02, DEPLOY OK)
Root cause, proven against production `rebuild_sync_runs` history: the
worker tick spent launch budget (maxConcurrentJobs=4) in priority order
and no-op re-launches on later ticks of the same minute consumed budget
too, so jobs ordered past the 4th due match were never evaluated at
crowded minutes. analyticsAlerts, sharingDeadlines and captionTests had
ZERO runs ever; webhooks (384/d), workspaceExports (536/d), aiVideos
(412/720), analyticsReports (72/288, only :05/:25/:55), feedsPoll (missed
:00) and postExports (missed :00/:15/:20/:30) were partial. The predicted
slot table matched observed histograms exactly before the fix. Fix:
tick skips already-ran-this-minute jobs BEFORE spending budget
(`worker.ts`); `launch()` keeps its guards for races and runNow.
Regression test fails pre-fix (verified via stash), passes post-fix.
Production proof within minutes of deploy: sharingDeadlines 01:25:07,
analyticsAlerts + captionTests 01:30, webhooks/workspaceExports back to
every-minute cadence. retention missed 01:17 UTC pre-fix (predicted);
next natural slots: retention tomorrow 01:17 UTC, rollups 23:30 UTC.
operatorMonitoring's full 1440/d comes from the web-process watchdog, a
second single-job worker, not the main loop.

## 2026-10-24 batch 16: post-history provider-window fit (6a6dbf75, DEPLOY OK)
Residual analytics failed=6 (after batch 13) were all `[postHistory]
AbortError` at exact 60s intervals: each post cost ~14 serial Graph calls
(7 insight metrics + 7 paged reaction edges) with pageSize=100 and
pageBudget=2, so any active Page always exhausted the 60s
`sync.resourceOperationTimeoutMs` window; the cursor only commits on
success, locking 6 targets into an infinite hourly abort loop (cursors
stuck at `after: null`, one-year `since`). Fix in `post-history.ts`:
batch lifetime metrics into one call per post (individual retry when one
metric poisons the batch, preserving per-metric failure semantics), skip
the reaction edge fan-out when `post_reactions_by_type_total` is already
authoritative (skipped edges stay null in provenance, never zero), and
enrich posts on 4 ordered lanes (`mapPool`). Tests updated to emulate
batched provider responses; new tests for batch shape, edge skip, and
order under concurrency. 20/20 post-history + 34/34 related + full suite
779 files / 12306 tests green, typecheck clean. PROVEN at the 02:15 UTC
run: outcome ok (was failed), 147s (was 610s), examined=12 updated=1205
(was 324) failed=0 (was 6); all 10 history cursors completed fresh
year-windows (complete=true). The infinite abort loop is broken.
(Note: cursor `updatedAt` is stamped with run start, not commit time.)

## Matrix rerun verdict (2026-10-24 ~02:14 UTC)
V2 rerun 544/544 cells: 208 findings, ALL preview-dev-server transport
flaps (`ERR_CONNECTION_REFUSED` / `ERR_INCOMPLETE_CHUNKED_ENCODING`,
one 60s goto timeout) on 9 routes — zero app, overflow, contrast or
keyboard findings (0 screenshots). V2b scoped rerun cleared 8 of the 9;
`/content/library` flapped twice more, then passed 32/32 with 0 findings
on a fresh preview (v2d). Matrix effectively green; every route passed
clean in at least one stable run. Triage note: the report's `failures`
field includes `fatal MISSING_ROUTE_FAMILY` entries in scoped
(MATRIX_ONLY) runs — always recount from cell findings.

## Dry-run rehearsal (2026-10-24 ~02:18 UTC, QA lane)
Seeded one due scheduled post + pending target in QA, switched
`jobs.stagingDryRun` on, ran `posts` via runNow: summary `skipped=1`,
`worker.staging_dry_run` audit row in `root_activities` (job=posts,
kind=publish, count=1, actorId NULL), seed post/target untouched
(still scheduled/pending — nothing dispatched). The run's `failed=1`
came from the platform hook's synthetic-token read (fail-closed, QA
only). Seed rows deleted, flag switched back off. QA restored.

## Live gates status (2026-10-24 01:46 UTC)
Llama: wired as 4th provider (`llamaPort`, OpenAI-compatible) and covered
by `ai-provider-ports` tests, but production has no Llama key
(`ai.provider=openai`, keys present only for anthropic/gemini/openai).
Live check BLOCKED on the owner provisioning a Meta API key.
Instagram live checklist, dry-run rehearsal: still open (rehearsal since
proven, see below). Rollups natural slot: today 23:30 UTC (post-fix) —
a one-shot check is scheduled for 23:45 UTC (cron 98d4c32c).
Retention (`17 3 * * *` server-local): tomorrow 02:17 UTC, not 01:17 —
EU DST ends Oct 25, so 03:17 local falls back to CET (02:17 UTC).
One-shot check scheduled for 02:30 UTC Oct 25 (cron 174f72d4).
Live release runs 6a6dbf75 (batch 16); later commits to origin/main are
docs/evidence only and ride the next app deploy.

## Webhook proof (2026-10-24 ~01:55 UTC)
Receiver proven end-to-end against production config: live route returns
403 on wrong verify token, 401 on unsigned POST, 404 on unknown platform;
a server-side drill signed a synthetic page-comment payload with the real
`meta.appSecret` and `ingestMetaWebhookDelivery` verified, parsed and
stored it (received=1/unmatched=1, receipt row confirmed then deleted).
0 historical receipts fully explained: no `meta.webhookVerifyToken` is set
(empty refuses every handshake by design) AND Meta reports
`subscribed_apps: []` for the sampled Page. Remaining owner steps: set a
verify token in Root settings, add the app subscription in the Meta
dashboard (callback `https://social.newsgeet.com/api/platforms/facebook/webhooks`).
Deliberately did not rewire the Meta app subscription unattended.

## More live gates (2026-10-24 ~02:00 UTC)
Instagram: prod has `platforms.instagram.enabled` at default off, no app
secret, 0 IG accounts/targets — correctly dormant; the section-2 owner
checklist prerequisites are not started, nothing actionable unattended.
Fixed one stale row in INSTAGRAM_LIVE_RUN.md (Facebook inbound webhooks
exist since the moat batch; IG still poll/manual).
Perfection backlog re-verified in current source and closed as sound:
lastSynced is MAX-or-null (`read.ts:280`), publish dry-run gate sits
upstream of all platforms (`sync.ts:22`, covers Telegram), Facebook inbox
is full-rescan with incomplete tracking (no cursor) by design.
