# Next phases — build plan (written 2026-10-11, start here)

The owner's request for the next sessions, verbatim intent:

> Better design and user experience. Analytics for **all connected profiles**,
> and show or hide per **single or multiple selection** of profiles. **All
> metrics from the Meta API.** Planned, posted or any information must use **the
> same selection**. Design must be better.

Work the phases in this order: **0 → G1–G3 → A (+ G5, G6) → B → C → C2 → D →
D2 → rest of G → H → S (final step: sell as a service)**; E and F whenever the
outside approvals arrive.

Work the phases in order. Each phase: build → unit + Playwright → deploy
(`scripts/deploy/deploy.sh`) → verify live in the owner's Chrome with real Pages
→ tick it in this file and in `STATUS.md`. Load the skills named in each phase.

---

## Where the code stands (facts to start from)

- **Calendar and Posts** already filter by Pages through `PagesSidebar`
  (`src/components/PagesSidebar.tsx`) with URL params `group` and `pages`, read
  server-side by `loadPageFilter()` in `src/lib/page-filter.ts` (always clamped
  to the member's `pageScope`). Groups: `src/lib/page-groups.ts`.
- **Analytics** (`src/app/(app)/analytics/page.tsx`) shows **one Page at a time**
  (`?target=<id>`, falls back to the first Page). The workspace overview and
  "compare Pages" exist but are separate views; `group` is only passed to some
  parts.
- **Dashboard, Queue, Reports, Ads, Inbox, Comments, Reviews, Videos** do not read
  the shared selection.
- Metric catalogue: `src/lib/facebook/metrics.ts` (`PAGE_METRICS`,
  `POST_METRICS`, `VIDEO_METRICS`, `IG_ACCOUNT_METRICS`, `IG_MEDIA_METRICS`,
  `AD_INSIGHT_FIELDS`, `REMOVED`, `CATEGORY_LABELS`). Fetching:
  `facebook/insights.ts`, `facebook/analytics.ts`; plain names in
  `src/lib/analytics.ts` (`PLAIN_NAMES`). Real-data facts: `META_API_NOTES.md`.

---

## Phase 0 — Email via Gmail + AI with Anthropic, OpenAI, Gemini (do first)

Owner's request (2026-10-11): "add Gmail app password in settings" and "add
also OpenAI and Gemini with models fetched automatically and API costs".
Skills: `frontend-design`, `ux-copy-house`, `run-tests`, `claude-api`
(Anthropic SDK usage), `security-review` (secrets).

### 0.1 Email: Gmail (SMTP) as a second provider
**Done 2026-10-11:** settings `email.provider` (auto | smtp | resend),
`email.smtpHost/Port/User/Password` (password encrypted); `src/lib/email/send.ts`
sends with nodemailer (SSL on 465) and explains refusals ("use an app
password"); `POST /api/settings/config/test-email` (root) + "Send test email"
button in Configuration → Email; setup checklist counts either provider.
Remaining: owner enters the Gmail address + app password and presses the test
button; Gmail daily-limit hint. The original spec follows.
Today: `src/lib/email/send.ts` uses Resend only (`email.apiKey`,
`email.from` in `src/lib/settings/definitions.ts`; blank = log only).
- New settings (group `email`): `email.provider` select `resend | smtp`
  (default: `smtp` when an SMTP password is set, else `resend`);
  `email.smtpHost` (default `smtp.gmail.com`), `email.smtpPort` (465),
  `email.smtpSecure` (true), `email.smtpUser` (the Gmail address),
  `email.smtpPassword` (type `secret`, encrypted like the others — the 16-letter
  Google **app password**, needs 2-Step Verification on the Google account).
- `send.ts`: `nodemailer` transport for `smtp`; keep Resend path. `from` must be
  the Gmail address (or a verified "Send mail as" alias) — Gmail rewrites other
  senders; say so in the hint. Gmail limit ≈ 500 recipients/day: show it.
- Settings → Configuration → Email: provider switch, fields, **"Send test
  email"** button (to the signed-in owner) that reports the exact result
  (sent / auth failed "Use an app password, not your Google password" / blocked).
- `emailEnabled()` true when the chosen provider is configured.
- **The owner types the app password themselves** in the UI; agents never enter or
  read it.
- Tests: unit for provider selection and error mapping (nodemailer mocked); e2e
  that the form saves and the secret is never echoed back.

### 0.2 AI: three providers, live model lists, costs
Today: `src/lib/ai.ts` is Anthropic-only (`ai.apiKey`, `ai.model` with a
**Owner's rule: no model list may be written in code — it must be fetched from
each provider.** **Done for Anthropic (2026-10-11):** `src/lib/ai-models.ts`
(`listAiModels()` via the SDK's `models.list`, cached 1 h; `resolveAiModel()` =
chosen model, else the newest listed), route
`GET /api/settings/config/ai-models[?refresh=1]` (root only), and the
Configuration model field is a picker filled from that list ("Newest model"
= blank). `ai.model` is now a free `string` setting with no options and a blank
default.)
**OpenAI and Gemini done too (2026-10-11):** `src/lib/ai-providers.ts`
(`activeAiProvider()`, `listProviderModels()`, `generateWith()`; fetch-based for
OpenAI `/v1/models` + `/v1/chat/completions` and Gemini `v1beta/models` +
`:generateContent`); settings `ai.provider` (auto | anthropic | openai | gemini),
`ai.openaiKey`, `ai.geminiKey`; a chosen model the provider no longer lists falls
back to the provider's first model.
**Prices and costs done (2026-10-11):** `src/lib/ai-prices.ts` (USD per 1M
tokens per model id, copied from the three official pricing pages on
2026-10-11, dated snapshots/aliases matched, unknown model = "price unknown",
never $0; Gemini's announced 2027 prices switch on their date);
`ai.priceOverrides` (list `model=input/output`, validated) and
`ai.monthlyBudgetUsd` (whole installation, calendar month UTC, 0 = none;
`errors.aiBudgetReached`); `AiGeneration.provider` + `costUsd` (migration
`20261013090000_ai_generation_cost`); Configuration → AI shows this month vs
budget, last 30 days by model and by workspace, cost per generation, unpriced
generations counted apart; the model picker shows each model's price.
Still to do: optional per-feature model; DB model cache table only if the 1 h
memory cache proves too short; refresh the price table when providers change
prices (overrides cover the gap).
- Settings (group `ai`): `ai.provider` select `anthropic | openai | gemini`;
  keys `ai.anthropicKey` (migrate from `ai.apiKey`), `ai.openaiKey`,
  `ai.geminiKey` (all `secret`); `ai.model` becomes a free value chosen from the
  fetched list. Optional per-feature model (captions vs. plan week) later.
- **Provider adapter** `src/lib/ai/providers/{anthropic,openai,gemini}.ts` with
  one interface: `listModels()`, `generate({system, prompt, maxTokens})` →
  `{text, inputTokens, outputTokens, model}`. Use `fetch` for OpenAI and Gemini
  (no new SDKs needed):
  - Anthropic: `GET https://api.anthropic.com/v1/models` (headers `x-api-key`,
    `anthropic-version`), `POST /v1/messages`; current ids in this era:
    `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`.
  - OpenAI: `GET https://api.openai.com/v1/models`, `POST /v1/chat/completions`
    (or `/v1/responses`); usage in `usage.prompt_tokens/completion_tokens`.
  - Gemini: `GET https://generativelanguage.googleapis.com/v1beta/models?key=…`
    (filter `supportedGenerationMethods` contains `generateContent`),
    `POST /v1beta/models/<id>:generateContent`; usage in `usageMetadata`.
  Check each provider's current docs before coding (`search-meta-docs`-style:
  official docs only).
- **Models fetched automatically**: on saving a key and from a "Refresh models"
  button; cached in the DB (new table `AiModelCache { provider, id, label,
  contextWindow?, fetchedAt }`), refreshed daily by the worker; the select shows
  only text-generation models, newest first, with the current choice kept even
  if it disappears (warn "no longer offered by <provider>").
- **API costs**: no provider exposes prices through its API, so keep a
  **price table** `src/lib/ai/prices.ts` (USD per 1M input / output tokens per
  model id prefix, with the date checked and the source URL), editable
  overrides in Configuration (`ai.priceOverrides` JSON). Store `provider` and
  `costUsd` on each `AiGeneration` (migration). Settings → AI shows: spend this
  month and last 30 days per provider/model, per workspace, cost per
  generation, and an optional **monthly budget** (`ai.monthlyBudgetUsd`) that
  stops AI calls with a clear message when reached. Unknown model price →
  show tokens and "price unknown — add it", never a fake $0.
- Model select shows the price next to each model ("$3 / $15 per 1M tokens").
- Tests: adapters with mocked fetch (model list parsing, usage parsing, error
  → "key rejected" / "rate limited" / "model not found"), cost maths, budget
  stop; e2e for the settings screen. Live: owner pastes the keys themselves; then
  one caption generation per provider, verify the cost line.

### 0.3 Root and separate privileges
**Done 2026-10-11** (see PERMISSIONS.md "Built"): `/root/*` section, users,
workspaces, invitations, privileges + CSV, root log, transfer + SSH script.
**Root oversight done 2026-10-11** (PERMISSIONS.md "Root oversight and
modules"): modules per workspace and per member, suspend/resume, open any
workspace as root (logged, banner), members managed from
`/root/workspaces/[id]`. **Worker status done 2026-10-12**: `/root/worker`
shows each worker process (alive within 5 min), every job's last attempt,
outcome (done · nothing to do · waiting for the allowance · failed), duration,
summary and last error, the Meta call allowance the worker last saved
(`graph_usage`: app %, calls in the last hour, throttle, per Page and ad
account), and a root-only "Test the app ID and secret" (`POST
/api/root/app-check`, one Graph call on request). Next: plans/limits per
client, delete users.
**Minimal .env done 2026-10-12**: `.env.example` holds infrastructure only
(PORT, HOST, APP_PORT, DATABASE_URL, POSTGRES_PASSWORD, SESSION_SECRET,
ENCRYPTION_KEY, TRUST_PROXY); every other value is a setting root manages on
`/root/config`. Values still in `.env` are flagged there with **Move into the
database** (`POST /api/root/config/adopt`; invalid ones stay and are reported).
Owner's rule (2026-10-11): the first registered user is root and sets up every
aspect of the app; other admins and users have separate privileges, which the
owner will audit. Root already exists (`isInstanceOwner`, first account only;
Configuration and setup are root-only). Root gets **its own section, separate from the rest** (`/root/*`, own
sidebar, own guard `requireRoot()`, 404 for everyone else; Configuration and
setup move there) — see [PERMISSIONS.md](PERMISSIONS.md) "Root has its own
section". Then build "To build": root console (all workspaces and
users), root passes every check with actions logged, root transfer + SSH
recovery script, a read-only privileges screen generated from one capability
table for the audit. Don't change the role matrix until the owner has audited it.

## Phase A — One profile selection, everywhere (highest priority)

Skills: `profile-selection`, `frontend-design`, `ux-copy-house`, `run-tests`.

**Goal:** a single "which profiles am I looking at" choice that every screen
obeys, kept as you move around the app.

**Progress 2026-10-11:** A1 done (`src/lib/selection.ts`, `loadSelection()` in
`page-filter.ts` with `net`, cookie `msp_sel_<workspaceId>`, never empty,
`scope` drop-in for `auth.pageScope`); A2 bar `ProfileScope` (search, groups,
networks, Only, Select all/Clear, phone bottom sheet) + `PagesSidebar`
remembers too; A3 on Dashboard, Calendar, Posts, Queue, Approvals,
Analytics, Reports; CSV export follows the selection (limited members get
their Pages, workspace-wide files need every Page); public API
`GET /api/v1/posts?pages=` (clamped to the key owner's Pages). API keys also
obey root's switches (suspension, modules, disabled account). Still: Ads (ad
accounts are not linked to Pages in the schema), Inbox/Comments/Reviews/Videos
screens (none exist yet as screens), headings with counts, e2e A4.

### A1. Selection model (server)
- Keep the URL as the source of truth (`?group=<id>&pages=<id,id>`; `pages`
  absent = all of the group / all Pages). Add **persistence**: when a screen is
  opened with no params, use the last selection from a cookie
  `msp_sel_<workspaceId>` (ids only; re-clamped to `pageScope` on every read,
  unknown ids dropped). Writing the cookie happens on change, client-side.
- Extend `loadPageFilter()` → `loadSelection()` returning
  `{ group, ids, all: boolean, pages, networks }`; also accept a `net` param
  (facebook, instagram, bluesky, …) to filter by network.
- One helper `selectionWhere(selection)` for Prisma (`targetId in ids`) used by
  every list query; one `selectionQuery(selection)` to build links so
  navigation keeps the selection (sidebar links in `AppShell` must carry it).

### A2. Selection UI
- **`ProfileScope` bar** at the top of the content area (not a top nav — the
  left sidebar stays): stacked avatars (max 5 + "+N"), label "All profiles (23)"
  / "3 profiles" / Page name, ▾ opens a popover:
  search · group chips ("All", groups, "+ New group") · network filter pills ·
  list with checkbox + avatar + network mark + name + 👁 · "Select all" /
  "Clear" · each row has **"Only"** on hover (select just this one) · footer
  "Show 3 profiles" (applies) and "Save as group". Simplified refs:
  `screens/02-account-picker.jpg`, `20-publishing-list.jpg`,
  `39-account-groups.jpg`.
- `PagesSidebar` (Calendar/Posts column) becomes a second view of the **same**
  state: toggling 👁 there updates the bar and vice versa. Hidden = greyed, still
  listed.
- Phone: the bar collapses to one pill "3 profiles ▾" opening a bottom sheet.
- Keyboard: popover is a listbox with type-ahead; Escape closes; focus returns.
- Empty selection is not allowed: clearing all shows "Pick at least one profile"
  and disables Apply.

### A3. Every screen obeys the selection
Dashboard, Calendar, Posts (list/feed/grid), Queue, Drafts/Approvals, Analytics
(all views), Reports (default scope of a new report), Ads (ad accounts linked to
the selected Pages), Inbox / Comments / Reviews, Videos, Exports (CSV/Excel),
public API `?pages=` parity. Each screen shows the bar; counts in headings say
what is filtered ("12 scheduled posts · 3 profiles").

### A4. Tests
- Unit: `loadSelection` clamping (ids outside `pageScope` dropped; cookie vs URL
  precedence; group + pages intersection; network filter).
- e2e: select 2 of 3 seeded Pages on Calendar → go to Posts, Analytics,
  Dashboard: only those 2 appear everywhere; reload keeps it; a viewer with a
  restricted scope can't widen it by editing the URL; phone sheet has no
  horizontal scroll.
- Live: with the owner's Pages, select DIY Page 3 alone → calendar, posts and
  analytics all show only it.

---

## Phase B — Analytics for all selected profiles

Skills: `analytics-dashboard`, `dataviz`, `meta-api-integration`,
`frontend-design`.

### B1. Modes driven by the selection
*Progress (2026-10-11):* the **All profiles** view (`view=total`,
`TotalProfilesView`) is the default with 2+ profiles: summed KPI tiles
(reach labelled "up to"), rate recomputed, top profiles by interactions and
growth, link to Compare. Rules live in `src/lib/aggregate.ts`
(`tests/aggregate.test.ts`). Compare has a chart with one line per profile
(interactions / posts / reach, top 8 + Others, legend hides lines without
touching the selection; `CompareChart`) and its totals row says reach "up to".
By post covers every selected profile (Page column, picker "All N selected
profiles") until one Page is picked. Still to do: CSV of the compare table.
- **1 profile selected** → today's deep Page view (all sections).
- **2+ profiles** → **Aggregate** view by default with a segmented switch
  **Total · Compare · Table**:
  - *Total*: KPI cards summed with the correct rule (below), one line per KPI.
  - *Compare*: KPI card selects the metric; chart = one line per profile
    (max 8 lines; beyond that top 8 + "Others"), legend toggles lines (show/hide
    per profile without changing the global selection).
  - *Table*: one row per profile × chosen metrics, sortable, totals row, export.
- Ranking widgets: "Top profiles by engagement / growth", "Top posts across the
  selection" (post table already exists — make it multi-Page with a Page column).

### B2. Aggregation rules (must be in code and in ⓘ tooltips)
| Metric kind | Rule across profiles |
|---|---|
| Counts (views, engagements, reactions, comments, shares, clicks, posts, new/lost follows, video views) | Sum |
| Unique people (viewers / reach `*_unique`) | **Not additive.** Show the sum labelled "up to N people (people who saw several Pages are counted once per Page)", and per-profile values in Compare/Table |
| Followers (lifetime level) | Sum of each profile's latest value; change = sum of changes |
| Rates (engagement rate, CTR, CPC, CPM) | Recompute from summed numerators/denominators, never average the rates |
| Demographics (country/city follows) | Sum per country/city across profiles (period=day caveat, see META_API_NOTES) |
| Money (ads) | Sum per currency; never mix currencies — group by currency |

### B3. All metrics from the Meta API
*Progress (2026-10-11):* the full list already lives in Analytics → Overview
(every stored Page metric by category, plain name, description, withdrawn ones
listed with Meta's reason). A star pins a daily Page metric (max 8, saved on
the user, `User.pinnedMetrics`, `PUT /api/analytics/pinned`); pinned metrics
show as tiles on Analysis and All profiles (`src/lib/pinned-metrics.ts`:
counts summed, followers = last value, unique people "up to"). Still to do:
post / video / Instagram / ads levels in the explorer.
- **Metric explorer**: a "All metrics" view listing every metric of
  `PAGE_METRICS`/`POST_METRICS`/`VIDEO_METRICS`/`IG_*`/`AD_INSIGHT_FIELDS` by
  `CATEGORY_LABELS`, plain name + ⓘ definition + level + availability
  (available / needs permission / withdrawn by Meta with date from `REMOVED`).
  Tick metrics to add them as KPI cards or chart series; the choice is saved per
  user (Prisma `UserPreference` or JSON column).
- Withdrawn metrics are shown greyed with "Meta stopped providing this on <date>"
  — never as empty charts.
- Budget: aggregate fetches go through the existing `budget.ts`; prefer stored
  snapshots (sync job) over live calls for 2+ profiles; show "Updated 12 min
  ago" (`AutoSyncNote`). No pull buttons: the worker reads Facebook.

### B4. Design upgrade of analytics (Simplified refs 01, 05, 19, 42, 44)
- KPI card = label · big value · change pill (arrow + %) · sparkline; cards are
  toggles for the big chart (several on = several lines, one axis per unit).
- Two plain-language insight tiles at top: best day, best posting frequency.
- Date range picker shows and edits the comparison period.
- Shared hover tooltip listing every series at that date.
- Every chart has a table view (`ChartFrame`) and ⓘ.

### B5. Tests
Aggregation unit tests for each rule (including unique-reach labelling and
currency grouping); e2e for mode switching and legend toggles; live check that
the summed followers equal the sum of the Pages' numbers on Facebook.

---

## Phase C — Publishing views on the same selection, better design

Skills: `frontend-design`, `profile-selection`.
*Progress (2026-10-11):* calendar status pills filter the grid (`?status=`,
several combine, counts stay the month's) and editable posts drag to another
day (month) or hour (week) — `CalendarDrag`, a PATCH like any edit; past days
do not take a drop. Posts: tick posts (or a whole day) and move them by N
days, add/remove a label or cancel them (`POST /api/posts/actions`,
`src/lib/post-bulk.ts`; each post keeps its own rules, refusals are listed).
Compose starts on the narrowed selection (never on every Page by default); the
preview already shows the first comment and post cards a status per
destination. E2e for drag and bulk is due at the next browser checkpoint.
- Calendar: profile colour dots on chips, filter by status (planned / posted /
  failed / draft / review) as pills next to the bar, drag-and-drop rescheduling,
  collapse the Pages column (ROADMAP UX backlog), day hover actions (ref 40).
- Posts: list / feed / grid share one toolbar; bulk select → reschedule, label,
  delete (with `useConfirm` and counts).
- Per-network status chips on post cards.
- Compose: default destinations = current selection; first comment shown in the
  Facebook preview.

## Phase C2 — From the full Simplified crawl (docs/inspiration/simplified/CRAWL-2026-10-11.md)
Each verified missing in our code on 2026-10-11:
- **Dashboard** leads with the upcoming queue for the current selection
  (+ "New post", "Plan with AI", connected-profile avatars) and a shortcuts
  column with counts (unread inbox, waiting approvals, failed posts).
- **Inbox stream**: one merged, chronological view of comments + messages for
  the selection, type filter, and a **resolved / unresolved** state (no such
  field today — needs a migration).
- **Notifications matrix** per member × Page × event (publish failed, account
  disconnected, new message, queue empty, draft updated, weekly summary).
  Today `NotificationSetting` has 4 workspace-wide booleans only.
- **First day of week** workspace setting (calendar, week view, reports).
  **Done 2026-10-12:** `Workspace.weekStartsOn` (0 Sunday … 6 Saturday,
  default Monday), chosen in Settings (Monday · Sunday · Saturday); month and
  week grids, their headers and weekly scheduled reports follow it.
- **AI weekly recap** on scheduled reports: plain-language "what changed and
  why" at the top (needs the Anthropic key).
- MCP setup page: step-by-step per assistant (Claude, others) with copy buttons.

## Phase D — Design system pass

Skills: `frontend-design`, `design:design-critique`,
`design:accessibility-review`.
- Critique every signed-in screen at 1440 px and 375 px against Simplified
  screens; fix hierarchy, spacing, empty states. Record results in `DESIGN.md`.
- Tokens: add elevation and spacing scale, dark mode (tokens are in
  `tailwind.config.ts`).
- Connections page: tabs or anchor chips.

## Phase D2 — Owner's picks from the Simplified crawl (decided 2026-10-11)

The owner reviewed everything skipped after the full crawl and chose to
**include** these. Everything else that was skipped stays out (see "Decided
out" below); don't propose it again unless the owner asks.

**Design (do with Phase D):**
- **App shell like Simplified: icon rail + module sidebar + top bar.** Far-left
  narrow icon rail for the main areas (Home, Publishing, Analytics, Inbox,
  Reports, Settings…), next to it the module sidebar with that area's pages, and
  a slim top utility bar (collapse sidebar, breadcrumb, search, notifications,
  help, workspace settings, avatar). This is still left-side navigation: **no
  top tab row for modules**; the top bar holds utilities only. Ref
  `screens/20`, `CRAWL-2026-10-11.md` § Visual note, README §2. Update
  `AppShell.tsx`; phone: rail + sidebar become one drawer.
- **Warm light theme (cream + amber), as a selectable theme.** Add theme tokens
  in `tailwind.config.ts`/`globals.css` (CSS variables) with two themes:
  *Facebook* (blue `#1877f2`, today's look, default) and *Warm* (cream
  sidebar, white cards, amber accent, dark icon rail). User setting in
  Settings → Preferences; build dark mode on the same variables. Check contrast
  (amber on white needs a darker amber for text, WCAG AA). Ask the owner which
  is the default before shipping.

**Integrations:**
- **Google Sheets import/export**: export posts, schedule and analytics tables
  to a Sheet; import posts from a Sheet (same columns as the CSV bulk upload).
  Google OAuth (Sheets + Drive file scope), owner creates the Google Cloud app.
- **Media from Dropbox, Box, Google Drive** in the composer and media library
  (each provider's file picker; copy the file into our media storage, never
  hot-link). Owner creates the developer apps; keys in Configuration.
- **Competitor tracking**: add public Pages to watch (followers, posting
  frequency, engagement per post, top posts), benchmark against the selection.
  Needs Meta **Page Public Content Access** (feature review) — prepare it with
  the `app-review-prep` skill after step 2. Until approved, build the UI with
  the data the app can read and show "Waiting for Meta approval".
- **Referral & rewards programme**: a referral link per user, sign-ups
  attributed, rewards ledger (e.g. free months/credits), Settings → Rewards.
  Ask the owner for the reward rules before building; no payments handled by
  the app.

### Selling as a service — decided
The owner will **host and sell the app as a service**. On 2026-10-11 the owner
moved **billing / plans / usage limits** and **custom domain (white-label)**
back in, **as the final step** (Phase S4, S6).

### Decided out (owner, 2026-10-11)
AI agent with schedules, AI image/video/voice hub, workspace brand book, agents
catalogue, link-in-bio, design editor, Facebook coloured text backgrounds,
location tags and @mentions, tasks & workflows, custom fields, mobile app /
Chrome extension. (Billing/plans and custom domain moved to Phase S.)

## Phase G — Owner-approved additions (2026-10-11)

All 18 ideas below were approved by the owner. Order: **G1–G3 right after
Phase 0** (they protect the installation), **G5–G6 with Phase A** (they save the
most time), the rest after Phase D2. S/M/L = effort.

### Security and reliability
- **G1. Two-step sign-in (S)** — TOTP (authenticator app) and passkeys
  (WebAuthn); **mandatory for root and admins**, optional for others; 10
  recovery codes shown once; "remember this device 30 days". Lost device →
  root resets it for others; root's own reset only by the SSH recovery script
  (PERMISSIONS.md). Tests: sign-in blocked without the second step.
  Skills: `secure-code-guardian`, `security-review`, `playwright-expert`.
  **Done 2026-10-11:** `src/lib/totp.ts` (RFC 6238, no library),
  `src/lib/two-step.ts` (policy `security.twoStep` admins|everyone|off; admins =
  root + owners/admins of a workspace with a connected profile; pending sessions
  `Session.pending`; recovery codes; trusted devices 30 days), passkeys
  (`src/lib/passkeys.ts`, @simplewebauthn), screens `/login/two-step` and
  `/login/two-step/setup`, Settings → Account section, root "Reset two-step",
  `scripts/admin/reset-two-step.ts` for root's own. e2e runs with
  `SECURITY_TWO_STEP=off`; a two-step browser spec is still to write.
- **G2. Off-site backups (S)** — after the nightly
  `/usr/local/sbin/ms-social-pilot-backup`, push the dump + media archive,
  encrypted (age/gpg, key held by the owner), to Backblaze B2 / S3 / Google
  Drive via `rclone`; keep 30 daily + 12 monthly; **monthly restore test** into
  a scratch database on the server that reports row counts; status shown in the
  root section. Owner creates the storage account and enters its key. Document
  in RELEASE.md.
  **Built 2026-10-11** (scripts + Root → Backups); waiting on the owner to
  create the storage account and run `scripts/server/install-offsite.sh`.
- **G3. Alerts when something breaks (S)** — worker heartbeat missing > 5 min,
  publish failures above a threshold, Page disconnected / token expiring, disk
  > 85 %, backup or restore test failed, Meta usage near the limit. Channels:
  email (Phase 0.1) and Telegram (chat channel code exists). One alert per
  incident, a "resolved" message after; settings in the root section.
  **Done 2026-10-11:** `src/lib/system-alerts.ts` (incidents in `SystemAlert`),
  worker job `alerts` every 5 min, worker-heartbeat watch in the web server
  (`instrumentation-node.ts`, production only), settings group Alerts, Root →
  Alerts with open incidents, history and a test button.
- **G4. Active sessions (S)** — list of a user's sessions (device, browser,
  IP/country, last seen) with "Sign out" and "Sign out everywhere else"; email
  on sign-in from a new device; root sees all users' sessions.

### Facebook growth and safety
- **G5. Website auto-share (M)** — users add their own sites. Per site: RSS/Atom
  feed or WordPress REST API
  (`/wp-json/wp/v2/posts?_embed`), target Pages, caption template
  (`{title}`, `{excerpt}`, `{link}`, hashtags), featured image, spread rule
  (e.g. one Page every 20 min, Page-specific best times), UTM per Page; new
  articles become scheduled posts (or drafts for review). Builds on the existing
  RSS feature. Works for any site and niche.
- **G6. Spam-risk guard (M)** — before scheduling, detect the same link or
  near-identical text going to many Pages within a short window; warn with the
  count and suggest **auto-stagger** (spread over N hours) and **AI caption
  variants** per Page; workspace setting for the minimum gap. Never block —
  explain and offer the fix.
- **G7. Comment moderation rules (M)** — rules per Page or group: hide comments
  with links / phone numbers / keywords, alert on keywords, auto-reply to
  matching questions (with a daily cap and "only once per user"); log every
  automatic action, undo from the log. Reminder: a Page cannot hide its own
  comments (META_API_NOTES). Uses `pages_manage_engagement` (already
  requested); comment webhooks make it real time (`webhook-setup` skill).
- **G8. Saved replies (S)** — reusable answers with variables (`{first_name}`,
  `{page}`) for comments and Messenger; shortcut `/` in the reply box; shared
  per workspace.
- **G9. Caption A/B tests (M)** — two (or more) captions for the same content on
  comparable Pages or times; after N hours compare engagement rate per view;
  declare a winner only with enough views (show "not enough data" otherwise);
  learnings saved to the Page voice.
- **G10. Best time per Page, automatically (S)** — weekly job recalculates each
  Page's best hours from its own posts (existing heatmap) and proposes or
  applies queue slots (setting: suggest / apply); shows what changed.

### Content
- **G11. AI translation (S, after 0.2)** — translate a post into each language
  of the target Pages' audiences (H0: e.g. French, English US, Spanish) as
  per-Page variants; right-to-left preview when an audience language needs it;
  keep hashtags and links.
- **G12. More interface languages (M)** — beyond en/fr, add languages the
  owner picks (e.g. Spanish `messages/es.json`, Arabic `messages/ar.json`);
  make the layout RTL-ready (`dir`, logical CSS properties) so right-to-left
  languages work; ICU plurals per language; locale tests check every file has
  the same keys and placeholders.
- **G13. Watermark and auto-crop (M)** — per-Page logo/text watermark (position,
  opacity), applied when the post is published (original kept); crops/resizes
  per network format (feed 4:5, story 9:16, link 1.91:1) with a focal point.
- **G14. Short-link click analytics (S)** — dashboard of clicks per Page, post,
  article and day (data already collected by the shortener), top articles,
  clicks per 1,000 views; obeys the shared selection.

### Operations
- **G15. Status page (S)** — public or root-only `/status`: app, worker,
  database, last publish, last backup, uptime history (90 days).
- **G16. Error tracking (S)** — self-hosted GlitchTip or Sentry: server, worker
  and browser errors with release hash; no personal data or tokens in events
  (scrub); link from the root section.
- **G17. Export everything (M)** — per workspace: posts, schedule, analytics,
  comments, media as a ZIP (JSON + CSV + files), built in the background with
  a download link that expires; also answers GDPR requests.
- **G18. Promote a post (L)** — boost a published post (budget, duration,
  audience: location/age/interests, ad account) from the post card; results in
  the Ads view. Needs `ads_management` + Meta review and the owner's OK for each
  spend; build after Meta step 2. Never spend without an explicit confirmation
  showing the amount.

## Phase H — More owner-approved additions (2026-10-11)

All 20 approved. Suggested order: **H0 first** (everything audience-related
depends on it), then **H2, H3, H10, H18, H1**, then the rest.

**No audience is assumed.** The target audience is whatever the user defines
per Page (French, US, Spanish, …) — never hard-code a country, language,
religion or holiday set.

- **H0. Target audience per Page (S, foundation)** — Page settings → Audience:
  countries (multi), languages (multi, BCP-47: `fr-FR`, `en-US`, `es-ES`, …),
  audience time zone (default: the main country's; used for best times and
  queue slots), and cultural calendars to follow (chosen from a list, none by
  default). Workspace default that new Pages inherit. Suggest values from the
  Page's own follower countries (`page_follows_country`) but the user decides.
  Used by H2, H7, G10, G11, AI writing (language + tone) and reports. Several need the AI
setup from Phase 0.2 (marked AI).

### Planning and content
- **H1. Content mix planner (M)** — per Page or group, a weekly mix by category
  (categories the user creates, e.g. 4 × "Product" · 1 × "Tip" · 1 ×
  "Question"); the queue fills slots to match from
  drafts, evergreen and WordPress items, and warns when a category runs dry.
  Categories = post labels (exist).
- **H2. Cultural calendar and seasonal modes (S)** — from the audience (H0):
  public holidays of each country the user chose (from a worldwide holidays
  dataset/API covering every country, not hand-typed) and any cultural or
  commercial calendars the user ticks from a worldwide list, plus **custom
  dates the user adds** (launches, sales, events), shown on the calendar with
  "Make a post" (awareness days exist — extend to all countries).
  **Seasonal posting modes** defined by the user per Page: a date range plus a
  rule (shift slots, fewer/more posts, different times, pause). Nothing on by
  default; no country or religion favoured.
- **H3. Posts from structured page data (M)** — read schema.org JSON-LD from
  the user's linked pages, whatever the niche (`Article`, `Product` with price
  and offers, `Event` with date/place, `Recipe`, `JobPosting`, `Course`,
  `LocalBusiness`, …) and offer matching templates: key facts post, carousel
  from images/steps, countdown for events, price/offer post; extends G5.
- **H4. Post templates by category (S)** — saved structures the user creates
  (e.g. tip, poll, promo, announcement) with placeholders, default hashtags and first comment; pick in Compose.
- **H5. AI alt text and subtitles (M, AI)** — alt text suggested for every photo
  (editable, sent as Facebook alt text — already supported); Reel/video
  transcription to burned-in or SRT captions (speech-to-text provider; OpenAI
  or Gemini from 0.2).
- **H6. Engagement prediction (M, AI)** — before scheduling, compare the draft
  (format, length, time, topic) with the Page's past posts; show "likely above
  / around / below this Page's usual" with the reasons; never a fake precise
  number.
- **H7. Trending topics (S)** — Google Trends daily trends for each country in
  the Page's audience (H0), filtered by the workspace's themes; "Make a
  post" opens Compose with the topic.

### Team and clients
- **H8. Internal notes on posts (S)** — team-only comment thread on each post
  with @mentions (notifies), never published; shown in Compose, calendar
  popover and approvals.
- **H9. Post version history (S)** — every save stores a version (text, media,
  targets, time, who); compare and restore.
- **H10. Undo send (S)** — "Publish now" waits 30 s (setting 0–60 s) with an
  "Undo" toast; the worker publishes after the delay; scheduled posts
  unaffected.
- **H11. Inbox response time (S)** — first-response and resolution time per
  Page and per member (median, slowest), business hours aware; in analytics
  and reports.
- **H12. Goals per Page (S)** — monthly targets (followers, views, engagement,
  posts) with progress bars and pace ("on track / behind"), in the dashboard
  and reports.
- **H13. Notes on charts (S)** — annotations (date, label, colour) on analytics
  timelines, per Page or workspace; shown in reports.
- **H14. Agency overview for root (M)** — in the root section: KPIs for every
  workspace (Pages, posts scheduled/failed, followers change, engagement,
  disconnected Pages, AI spend), sortable, drill-down.

### Monitoring
- **H15. Negative-comment alert (M, AI)** — sentiment on new comments (batch,
  cheap model); alert when negative share or volume spikes vs the Page's
  baseline; links to the comments; respects G7 rules.
- **H16. Meta API usage per Page (S)** — record call counts and the
  `x-app-usage` / `x-business-use-case-usage` headers per Page (budget.ts
  already reads them); root view with the heaviest Pages and jobs.
- **H17. Earnings tracking (M, check first)** — verify which monetisation
  metrics the Graph API still returns for these Pages (META_API_NOTES, the
  `search-meta-docs` skill); build only what is available; otherwise document
  "not available" and stop.

### Connections
- **H18. Outgoing webhooks + Zapier / n8n / Make (S)** — events: post
  scheduled, published, failed; comment received; Page disconnected; report
  ready. Signed payloads (HMAC), retries with backoff, delivery log; uses the
  public API tokens that exist.
- **H19. Calendar feed (S)** — private ICS URL per member (selection-aware:
  pages/group in the token), revocable; Google Calendar / Outlook subscribe.
- **H20. Bulk Page info editing (M, check permission)** — edit hours,
  description, website, phone, cover across selected Pages; confirm Meta
  permission (`pages_manage_metadata` or Page settings fields) and add it behind
  a switch like the other optional scopes; preview the change per Page; log
  and undo.

## Phase S — Ready to sell as a service (FINAL STEP, owner 2026-10-11)

Build last, after every other phase. S1 (generic sweep) and S2 (operator
details) may be done earlier if a phase touches those files.

The app will be hosted and sold to other users when done. Everything must be
generic (CLAUDE.md rule 9). Items:
- **S1. Generic-content sweep** — remove every niche/country leftover from code,
  copy, defaults and demo data. Known today: Terms and Privacy pages
  (`src/app/terms/page.tsx`, `src/app/privacy-policy/page.tsx`) name Morocco
  and Moroccan law and the newsgeet.com URL; code comments using Casablanca as
  the example time zone (`report-schedules.ts`, `date-range.ts`); demo seed
  (`prisma/demo.ts`) and test fixtures using recipe/bakery text and Casablanca
  (fine as test data, but prefer neutral). Add a test that greps `src/` and
  `messages/` for a blocklist of owner-specific names.
- **S2. Operator details set by root** — in the root section: company/operator
  name, country, address, contact email, governing law, data-protection
  authority, product name and logo, app URL. Terms, Privacy, Data deletion and
  emails read these; no hard-coded legal text naming a country. The legal
  wording itself is the owner's responsibility (suggest they have it reviewed).
- **S3. Self-service sign-up** — open registration (root switch exists), email
  verification, onboarding wizard that asks the user's niche-free basics
  (workspace name, time zone, languages, first Pages), trial period.
- **S4. Plans and billing (decided: yes, final step)** — plans with limits
  (Pages, members, scheduled posts, AI spend), payment provider (Stripe or
  Paddle; the app never stores card data), invoices, plan changes, dunning,
  usage page. Ask the owner for the plans, prices and limits before building.
- **S5. Tenant isolation review** — **started 2026-10-11 (owner asked to do it first):** cross-workspace sweep test + three routes fixed to answer 404; rate limits per workspace and AI metering still to do — every query scoped by workspace and
  `pageScope`; e2e that one customer can never read another's data; rate
  limits per workspace; per-tenant AI keys or shared keys with metering
  (ties to 0.2 costs).
- **S6. White-label (decided: yes, final step)** — custom domain per customer for the
  client portal and share links, custom logo/colours (theme tokens from D2).
- **S7. Product site and docs** — public landing, pricing, help center, status
  page (G15), changelog. All copy generic.

## Phase E — Blocked on owner / Meta (unchanged)
Meta App Review step 2 → Live mode; owner enters the Gmail app password and the
Anthropic / OpenAI / Gemini keys (after Phase 0); LinkedIn / Threads
/ X / Pinterest developer apps; first live Bluesky / Mastodon posts. See
`ROADMAP.md`.

## Phase F — Later
Analytics for non-Meta networks (into the same selection and aggregation rules),
competitor tracking, unified inbox, AI images, YouTube/TikTok, GDPR export —
details in `ROADMAP.md`.
