# AGENT.md — AI Agent Engineering Playbook

Read this file first before modifying the codebase. It is designed to give any AI model complete architectural context in minimal tokens.

---

## 1. Repository Layout

Only 3 markdown files exist at the root (`README.md`, `AGENT.md`, `PLAN.md`). All application code lives inside `app/`:

```text
app/
├── prisma/
│   ├── schema.prisma                        # Authoritative Prisma schema (clean table names, no rebuild_ prefix)
│   └── migrations/
│       ├── 0001_init/migration.sql          # Consolidated initial PostgreSQL schema
│       └── 0002_remove_rebuild_prefix/      # Idempotent migration renaming any legacy rebuild_* objects
├── scripts/
│   ├── deploy.sh                            # Unified fresh-install, update & admin CLI (--host, --key/--pass, --local)
│   └── worker.ts                            # Background worker process (polls job_leases, runs sync/publish/CMS jobs)
└── src/
    ├── app/                                 # Next.js 15 App Router
    │   ├── (auth)/                          # /login, /register, /forgot-password, /reset-password, /invite, /share
    │   ├── (workspace)/                     # Authenticated workspace shell & feature routes
    │   ├── root/                            # Instance owner (/root) administration console
    │   └── api/                             # REST & MCP route handlers (/api/*)
    ├── components/                          # Shared UI primitives & AppShell (Topbar, Rail, CommandPalette, Dialog)
    ├── core/                                # Shared guards, session, crypto, pagination, rate-limit utilities
    ├── lib/                                 # Pure utilities (calendar-dates, i18n, config entry definitions)
    ├── modules/                             # Domain feature modules (`ui/` client components + `server/` services)
    ├── platforms/                           # Social network connectors & capability matrix (`PLATFORM_CAPABILITY_MATRIX`)
    ├── server/                              # Prisma singleton, runtime config store, worker loop, root health
    └── styles/                              # Global CSS design system (tokens.css, shell.css, components.css)
```

---

## 2. Domain Modules Map (`app/src/modules/`)

Every domain module separates browser UI (`ui/`) from server logic (`server/`):

| Module | Path | Responsibility |
| :--- | :--- | :--- |
| **Publishing** | `src/modules/publishing/` | Post lifecycle, Composer (`ComposerWorkspace.tsx`), Calendar (`CalendarWorkspace.tsx`), Queue, Templates, Bulk CSV, Approvals |
| **Feeds & CMS** | `src/modules/feeds/` | Standard WordPress REST connector (`wordpress/db.ts`, `recipe.ts`, `server/wordpress-planner.ts`) & RSS/Atom feeds (`server/feeds.ts`) |
| **Inbox** | `src/modules/inbox/` | Unified comments, DMs, reviews, saved replies, sentiment, moderation rules (`InboxWorkspace.tsx`) |
| **Analytics & Insights** | `src/modules/analytics/`, `insights/`, `reports/` | Cross-channel metrics, daily/weekly rollups, Top Posts, metric alerts, scheduled reports |
| **Ads** | `src/modules/ads/` | Meta Ads overview, Campaign/AdSet/Ad management (`AdsManageWorkspace.tsx`), creative creation, analysis |
| **AI Studio** | `src/modules/studio/`, `writing-agents/`, `ai-video/` | AI caption generator, custom writing personas, A/B caption tests, short-form video assembly |
| **Channels & Connections** | `src/modules/channels/`, `connections/` | OAuth connection flow, channel discovery, channel groups, goals, health diagnostics |
| **Agency & Sharing** | `src/modules/agency/`, `sharing/`, `bio/` | Multi-workspace agency rollup, external share links, Link-in-Bio pages |
| **Tasks & Notifications** | `src/modules/tasks/`, `notifications/` | Team tasks with checklists/comments, in-app/email notifications, Slack/Discord/Telegram chat webhooks |
| **Settings & Root** | `src/modules/settings/`, `root/`, `security/` | Workspace settings, watermarks, MCP API keys, ZIP exports, 2FA/Passkeys, Root admin operations |

---

## 3. Architectural Contracts (Do Not Break)

### 3.1 Workspace & Role Isolation
- Every workspace API route and server action must authenticate through `src/core/http/guard.ts` (`withGuard`) or module access guards (`authorizeFeeds`, `withPublishingOperation`, etc.).
- **Never** query workspace tables without scoping by `workspaceId` (`WHERE "workspaceId" = ${actor.workspaceId}`).
- Respect channel-scoped members (`actor.allowedTargetIds`): if `allowedTargetIds !== undefined`, filter targets/posts/plans to that set.

### 3.2 Standard WordPress REST CMS Connector (`src/modules/feeds/wordpress/`)
- **No MariaDB / MySQL dependency**: The WordPress connector (`src/modules/feeds/wordpress/db.ts`) communicates exclusively over HTTP/HTTPS with the standard WordPress REST API (`/wp-json/wp/v2/`).
- **Authentication**: Public WordPress sites require only `siteUrl` (`https://...`). Private or custom endpoints can optionally set `feeds.wordpress.databaseUrl` in `/root/config` to a WordPress Application Password (`username:xxxx xxxx`) or Bearer token.
- **Recipe & Content Extraction (`extractRecipeJson` in `wordpress/db.ts`)**:
  1. Checks custom REST post meta (`mapping.recipeMetaKey`, default `_msrwa_recipe`).
  2. Extracts Schema.org `@type: "Recipe"` JSON-LD from Yoast/RankMath REST metadata (`yoast_head_json.schema`) or embedded `<script type="application/ld+json">`.
  3. Extracts HTML lists/paragraphs (including WP Recipe Maker `.wprm-recipe-*` markup) as a fallback so any WordPress recipe or article can be planned into slots.
- **Planned Slot Workflow (`server/wordpress-planner.ts`)**:
  - Claims slots atomically in `wordpress_recipe_plans` (`UNIQUE ("sourceId", "targetId", "slotAt")`).
  - Downloads and normalizes the recipe image via `prepareRecipeImage` (`wordpress/image.ts`), schedules the post via Publishing's `createPost`, and formats the delayed first comment using `renderComment` (`wordpress/recipe.ts`).

### 3.3 Social Platform Connectors (`src/platforms/`)
- All 11 connectors are registered in `src/platforms/index.ts` alongside `PLATFORM_CAPABILITY_MATRIX`:
  - **Primary (Enabled by default)**: `facebook`, `instagram`.
  - **Secondary (Toggled by Root Admin via `platforms.<id>.enabled` in `/root/platforms` or `/root/config`)**: `youtube`, `tiktok`, `pinterest`, `linkedin`, `x`, `threads`, `bluesky`, `mastodon`, `telegram`.
- Every connector implements `PlatformModule` (`src/platforms/module.ts`) and `PlatformAdapter` (`src/platforms/types.ts`).

### 3.4 Database & Migrations (`app/prisma/`)
- All database tables use clean, unprefixed names. Never introduce `rebuild_` prefixes.
- The numbered SQL files in `app/prisma/migrations/` are the source of truth; the deploy script applies them with `psql`.
  `schema.prisma` is introspected from the migrated database and describes all 136 tables. CI fails when they differ.
  **Never run `prisma db push` or `prisma migrate dev` against a real database.**
- When adding a schema change:
  1. Add a new numbered SQL migration under `app/prisma/migrations/` (idempotent where possible).
  2. Apply every migration to a local database, then `npx prisma db pull` and commit the updated `schema.prisma`.
  3. Run `npx prisma generate`, `npm run typecheck`, `npm run lint`, `npm test`.

### 3.5 Styling, Theme & Bilingual (EN/FR) Parity
- **Tokens**: Always use semantic CSS custom properties from `src/styles/tokens.css` (`--bg`, `--surface`, `--surface-raised`, `--text`, `--text-muted`, `--line`, `--brand`, `--success`, `--warning`, `--danger`). Never hardcode hex colors in components.
- **Numeric Alignment**: Use `font-variant-numeric: tabular-nums` on all counters, KPI cards, tables, and timers.
- **i18n**: Keep English (`en`) and French (`fr`) dictionaries in sync (`src/lib/i18n.ts` and module `copy.ts` files).

---

## 4. Development & Verification Workflow for Agents

Work on `main` and push there. Never commit or print secrets (app secrets, passwords, tokens); the Meta reviewer
account's password lives only in Meta's submission form.

Before committing or deploying any change, always run from `app/` (`npm ci` first: dependencies are not vendored).
Commit messages say what was verified and what was not run.

```bash
cd app
npx prisma generate
npm run typecheck
npm run lint
npm test
npm run build
```

To deploy to a remote server when requested by the user:
```bash
bash app/scripts/deploy.sh --host <SERVER_IP> --user root --key <SSH_KEY_PATH>
```

---

## 5. Releases and Auto-Update

- `app/scripts/deploy-from-server.sh` (installed on the server as `socialpilot-deploy`) and `app/scripts/deploy.sh`
  build apart, run `npm test`, dump the database, apply SQL migrations in `app/prisma/migrations/`, switch releases,
  check health and roll back on failure. A deploy run by a person also installs the updater, backup and deploy scripts.
- Root-run scripts (`updater.sh`, `backup.sh`, `deploy-from-server.sh`) are never replaced by an automatic update: the
  updater runs the installed copies with `SOCIAL_PILOT_UPDATER=1`. After changing one of them, tell the user to run
  `socialpilot-deploy` on the server once. Do not reintroduce running a script from the pushed commit as root.
- Backups: `social-pilot-backup.timer` nightly (`backup.sh`: database dump + media copy to
  `/var/backups/ms-social-pilot/`, optional off-site rsync via `/etc/ms-social-pilot-backup.conf`).
- Auto-update: GitHub calls `POST /api/updates/github` on each push (HMAC-checked with Root secret
  `updates.githubWebhookSecret`); a push to `updates.branch` (default `main`) of `updates.repository` is recorded in
  `app_updates` while `updates.automatic` is on. The root timer `social-pilot-updater` (every 30 s) runs
  `app/scripts/updater.sh`, which deploys that commit with its own deploy script and writes the result back.
  Root › Updates shows the running version, the history and « Update now ».
- The updater timer is installed only by the deploy script of a version that has it. 2026-11-10: pushes were
  recorded but stayed « Waiting » on social.newsgeet.com because nothing on the server picked them up (updater.sh
  itself was run locally and works); most likely the server's installed `socialpilot-deploy` was an older copy. The
  deploy script now hands over to the script of the version it installs and refreshes `socialpilot-deploy`;
  Root › Updates shows the one-time server command when a request waits more than two minutes.
- Root › Updates (2026-11-10 redesign): `modules/root/ui/UpdatesWorkspace.tsx` + `app/root/updates/updates.css`. Status
  card for the running version, update list with filter, confirm before « Update now », log and GitHub steps in
  modals (log fetched from `GET /api/root/updates/[id]`), list refreshes every 10 s while something waits or installs.
  Shared, app-wide (same day): on phones every `.ui-dialog` is a bottom sheet (`styles/responsive.css`) and every
  stacked `DataTable` row is its own card with the first column as headline (`styles/components.css`); class-less
  `select`/`input` inside `main` or a dialog get the standard control look (polish layer at the end of
  `components.css`). Reviewed on screenshots with an empty workspace only: no connected channels, posts or messages.
- **Auto-update is active (2026-11-10):** pushes to `main` install themselves on social.newsgeet.com in about 3 minutes.
  Verify a change there with the `SP_*` credentials (read-only: navigate and screenshot, never submit forms).
  The local database has no connected account, so content screens (Queue, Approvals, Library, Insights) can only be
  judged on the live site.
- Screen changes of 2026-11-10: Queue « By day » is an agenda (`queue.module.css` `.entry*`, rows are `<details>`);
  Library tiles open details from the picture, rename has no typed phrase; Approvals folds team notes and lays out
  non-empty stages full width; Root Users/Workspaces show reset and pager only when useful.
- Root › Configuration (2026-11-10): search bar pinned on top, results directly under it (they used to render
  ~3,600 px lower, under 72 section buttons); sections in a grouped side list on desktop and one picker below 1024 px;
  results ranked name > key > description, first 60 shown; `/` focuses the search; the address carries `?search=`
  (`?q=` accepted). Module and platform settings pages share the form (`root-config-form.tsx`).
- UX pattern agreed with the owner (2026-11-10, by form): a list row opens its details in a **centered window**
  (`components/SidePanel.tsx`, now a modal; bottom sheet on phones), creation forms that need a preview use
  `CreateDrawer wide`, identifiers stay out of lists under a folded « Technical details », and a confirmation asks to
  retype a phrase only when money can be spent or data lost (`useConfirm` without `exactConfirmation` otherwise).
  Applied to Posts, Post explorer, Tasks, Library, Ads accounts, Ads › Manage (details, creatives gallery, creative
  builder with live preview, parent picker by name), Inbox (details folded, comment first), Settings › Integrations
  (« New key » window), Root › Operations (plain wording, outcome marks). Ad set creation picks countries by name (`modules/ads/ui/countries.ts`) and the creation
  drawer shows one frame and one title. Not yet done in this pattern: Reports and
  schedules, Content feeds, campaign / ad set / ad creation forms, Settings › Team and Channels, Root lists.
  `npm run build` sometimes fails while fetching Google Fonts (`next/font` TypeError): retry, it is not the code.
- Analytics dates (2026-11-11): Facebook Page insights carry the END of the period (`end_time` 08:00 UTC = midnight
  Pacific); `coveredDays` in `platforms/facebook/analytics.ts` moves each Page row back one day at read time, for
  detailed rows and stored daily summaries alike (both are keyed by the end date). Page figures therefore change once a
  day, when Meta closes its day; Insights says so in a note. Post figures (external_posts) refresh hourly and are not
  shifted. Sync now reads 4 items at a time (`SCOPED_CONCURRENCY` in `platforms/facebook/jobs.ts`), ~2.5 min live.
- If a push to `main` does not show in Root › Updates within a few minutes, GitHub's webhook did not arrive (seen
  once on 2026-11-11): use « Update now » there, and check GitHub › Settings › Webhooks › Recent deliveries.
- Earlier note, kept for history. **Activation status (2026-11-09): not active yet.** It needs, once: (1) one manual deploy of current `main`
  (installs the timer), (2) Root › Configuration › Updates: save a webhook secret and turn on « Install GitHub pushes
  automatically », (3) GitHub › sebmouad/MS-Social-Pilot › Settings › Webhooks › Add webhook: payload URL
  `https://social.newsgeet.com/api/updates/github`, content type `application/json`, the same secret, push events
  only. Root › Updates says whether the webhook secret is set. Claude cannot add the GitHub webhook (no tool for it).

## 6. Local End-to-End Runs (no real Meta)

`app/tests/e2e/` drives the real app against a fake Meta, over HTTPS like production. Everything is local-only
(scripts refuse a non-local `DATABASE_URL`).

1. PostgreSQL: `service postgresql start`; create a database, apply every `prisma/migrations/*/migration.sql` in order.
2. Env: `DATABASE_URL`, `ENCRYPTION_KEY` (**base64 of 32 bytes**: `openssl rand -base64 32`), `SESSION_SECRET`,
   `NODE_ENV=production`, and `NODE_EXTRA_CA_CERTS=<cert.pem>` so the app trusts the fake Meta.
3. Self-signed cert for `localhost`; `node tests/e2e/fake-meta.mjs 4600 cert.pem key.pem` (Graph + login dialog;
   `/__test/comment`, `/__test/message` simulate a visitor, `/__test/state` shows what was sent);
   `node tests/e2e/https-proxy.mjs 3443 3200 cert.pem key.pem`; `npm run build && npx next start -p 3200`.
4. `node --import tsx tests/e2e/seed-owner.ts <email> <password>` then
   `node --import tsx tests/e2e/configure-fake-meta.ts <email> https://localhost:3443 https://localhost:4600`.
5. `mkdir -p /var/lib/ms-social-pilot/media` (default `storage.mediaRoot`).
6. The owner must enroll two-step (authenticator code from the setup key) before Root and connections work.

Drive it with Playwright (pre-installed). Every flow below has been run this way.

## 7. Current Project: Meta App Review Resubmission

Guide for the user (submission text, recording scripts, checklists):
https://claude.ai/artifact/NhkTtdKNASCrYEhpy3biKN — keep it in sync when screens change.

Meta app MS-Social-Pilot (ID 699780715171676), type Business, Facebook Login for Business, development mode.
Data controller: ANASSO TRAVAUX, Morocco. Reviewer app account: `meta-review@newsgeet.com` (password not stored here).

- 2026-10-24 verdict: approved `pages_show_list`, `business_management` (+ `public_profile`); refused
  `pages_read_engagement`, `pages_manage_posts`, `pages_read_user_content`, `pages_manage_engagement`, `read_insights`,
  `ads_read` — recordings did not show the full login, the grant and the use end to end, in English with captions.
  The first videos (release `meta-review-screencasts-2026-10-10`) were 1280 px, partly French, uncaptioned, idle for
  minutes, showed no visitor comments, no Instagram and an empty ad account.
- Resubmission scope: 14 permissions — the 6 refused plus `pages_messaging`, `pages_manage_metadata`,
  `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`,
  `ads_management` (and keep `business_management`). **One recording per permission** (Meta's guide).
  The October `ads_read` text says the app never creates ads: rewrite it, the app now creates paused campaigns.
- Decisions: two-step sign-in set to « off » in Root for the review window, back to « admins » after approval.
  Recordings: Claude records the app screens (1920×1080, English captions naming the permission, box on each click);
  the user records the Facebook / Instagram / Ads Manager parts (clips F1–F6 in the guide); Claude assembles 14 videos.

### 7.1 Phase 1 — done (2026-11-09), on `main`, not yet deployed

Login asks for all 14 permissions plus Meta's dependencies (`withScopeDependencies`); optional `meta.loginConfigId`
(config_id). Pages subscribed to webhooks on connect. Messenger replies use the Send API (`POST /{page}/messages`).
One « Connect Facebook » brings Pages, their Instagram accounts and ad accounts, pre-ticked. « Publish now » sends at
once and stores the post link (« View on Facebook/Instagram »). « Sync now » on Insights and Ads. Photo uploads work
by default (media root default, media share secret generated). Deauthorize/data deletion erase Facebook and linked
Instagram tokens. Plain wording on Channels; network shown on composer chips. Auto-update (above).

### 7.1b Review-readiness pass (2026-11-10), on `main`, live on social.newsgeet.com

Public front page at `/` for signed-out visitors (`LandingPage` in `modules/history/ui/public-pages.tsx`, text in
`modules/history/public/landing-copy.ts`; signed-in people still land on `/home`). Sign-in pages link to the privacy
policy, terms and data deletion. One product name everywhere: « MS Social Pilot » (sidebar, sign-in, public pages).
Home cards, Channels empty state, calendar empty note and inbox pager tidied.
Webhooks: only the Page object is handled; a signed delivery for another object (`instagram`, `user`) is acknowledged
and dropped. Instagram comments arrive through the inbox sync. The guide's screen names were corrected to the app's
(« Posts », « Channels » in the composer, « Save selections », « Sync now » in the Inbox).
Checked on the live site without signing in: front page, legal pages, callbacks refuse unsigned requests. Still blank
there: operator details (name, contact, update date) on the privacy policy and terms.

### 7.1c Audit for the resubmission (2026-11-10): what still blocks it

Checked: Meta's own records for the app (settings, review requirements, compliance), the public pages signed out,
and the reviewer-facing screens on the live site with the owner account (read-only).

Blocking, for the user:
1. `public.operator` is empty on the live site: the privacy policy and terms name no company and no contact
   (« the operator of this installation »). Fill Root › Configuration › Public site › operator details.
2. The 7 new permissions (`pages_messaging`, `pages_manage_metadata`, `instagram_basic`, `instagram_content_publish`,
   `instagram_manage_comments`, `instagram_manage_insights`, `ads_management`) cannot be added to the submission yet:
   Meta wants one successful API call with each first, counted up to 24 h later. The live Facebook connection dates
   from Oct 10 and holds the old 8 permissions: reconnect it, then use Inbox messages, an Instagram account and a
   paused campaign so each permission is called. `instagram_content_publish` and `ads_management` also list access
   verification.
3. No Instagram account is connected (10 Facebook Pages only): the four Instagram permissions cannot be shown.
4. Meta app settings: data deletion URL empty (set the callback
   `https://social.newsgeet.com/api/platforms/facebook/data-deletion` or the page `/data-deletion`), contact email
   not verified, display name « MS-Social-Pilot » while the site says « MS Social Pilot », a stale redirect URI
   (`/api/facebook/callback`).
5. `meta.webhookVerifyToken` is empty although webhooks are on: Meta cannot verify the webhook, so comments and
   messages arrive only on « Sync now ».
6. The reviewer account's workspace (« Meta Review's workspace ») has no channels but 8 ad accounts from an earlier
   connection; it is not a member of the workspace that has the Pages. Decide which workspace the reviewer uses and
   clean the other state before recording.
Fine: app is live, compliant, business verification passes, two-step is off, callbacks reject unsigned requests,
no console or network errors on the audited screens, public pages are reachable signed out and in English.
Fixed in code the same day: privacy policy names Instagram and ad accounts and has an « AI assistance » section
(comment text goes to the AI provider for sentiment in opted-in workspaces; AI is on in production), page titles
say « MS Social Pilot », Inbox page title matches its heading. The guide artifact is not yet updated for the
screens changed on 2026-11-10 (Queue, Library, Approvals, Updates).

### 7.1c Audit fixes (2026-11-10), on `main`

Next 15.5.29 with the image optimizer closed; nodemailer 10, sharp 0.35. Security headers on every response. Sign-in
lock counted per visitor and address. WordPress requests through the pinned network guard. A Meta deletion request
also erases the person's name, picture and ID from the connection record. ESLint (`npm run lint`) and CI
(`.github/workflows/ci.yml`). **Not upgraded, on purpose:** zod 3 → 4 (295 files and code reading zod internals;
needs its own tested change) and Prisma 6 → 7. `experimental.esmExternals: false` in `next.config.ts` is required: sharp
and nodemailer now ship ES-module builds, and loading those breaks the platform registry's circular imports at
start-up. `schema.prisma` lists all tables but 97 are `@@ignore`d: adding them to the generated client makes its
types so large that `next build` runs out of memory. `deploy.sh` and `deploy-from-mac.sh` still carry their own copy of the
server steps and do not take the pre-migration dump; `deploy-from-server.sh` is the path that does.

### 7.1d Done for the resubmission (2026-11-10, owner approved by form)

- Webhooks live: `meta.webhookVerifyToken` set on the site (Root config, encrypted), Meta app subscription `page`
  → `https://social.newsgeet.com/api/platforms/facebook/webhooks` with `feed` and `messages`; Meta's test delivery
  arrived (Root › Platforms › Facebook › Health, « Meta webhook deliveries »). Each Page is subscribed to the app
  (`subscribed_apps`) when Facebook is (re)connected, so the Oct 10 connection must be reconnected for real events.
- Operator details set: ANASSO TRAVAUX, Morocco, Moroccan law 09-08 (+ GDPR where it applies), updated
  « November 10, 2026 », address 56 Hay Ghizlan, Ain Aouda, Temara, contact contact@newsgeet.com, hosting Ikoula.
  Privacy policy, terms and data deletion now name the company, address and contact everywhere.
- The reviewer uses their own workspace (« Meta Review's workspace », reviewer connects Facebook themselves).
  Its 8 ad accounts from a removed connection were removed on 2026-11-10 (owner's go-ahead), so it is empty: no
  channels, no ad accounts, 2 old draft posts. Root › Workspaces shows « Remove N unlinked ad accounts » if it recurs.

### 7.1e Recordings (2026-11-11)

App-side videos recorded on the live site with `tools/review-recordings` (owner account, workspace MS) and sent to the
owner: 01 pages_show_list, 02 business_management, 03 pages_read_engagement, 04 read_insights, 05
pages_read_user_content, 06 pages_manage_posts (published one real post on Cuisine Pleine d'Envie, kept, approved),
07 pages_manage_engagement (replied « Merci ! 😊 » to a real comment on Recettes Sans Soucis, hid it, showed it again,
approved). Still to record: pages_messaging (owner sends a Messenger message to a Page first), pages_manage_metadata
(live webhook comment, after reconnecting Facebook), the 4 instagram_* (owner links an Instagram account), ads_read and
ads_management (owner asked to rework Ads like Meta Ads Manager first). The submission guide artifact
(NhkTtdKNASCrYEhpy3biKN) could not be opened from this session.

### 7.2 Phase 2 — next

1. User: deploy `main`; fill Root › Public site › Operator details (address, privacy email, law, host,
   `legalUpdated`); set two-step off; link an Instagram professional account to the test Page (the test Page, a second
   Facebook user and an ad account with a campaign exist); add `SP_URL`, `SP_USER`, `SP_PASSWORD` to the cloud
   environment for Claude.
2. Claude: check every screen on social.newsgeet.com in English (Playwright, login from `SP_*`, never printed), fix
   what a reviewer would not understand, then record the app parts per the guide's scripts R1–R8.
3. User records F1–F6 (Facebook in English, app removed from Facebook's Apps and websites first so the grant is
   first-time); Claude cuts, captions and joins them into 14 videos; the user submits with the guide's texts and the
   reviewer instructions (current screen names, not the October ones).

### 7.1f UX pass (2026-11-12)
- Ads: three tabs (Overview · Manage · Compare). `/ads/campaigns` forwards to Manage except for the Boost flow
  (`boostTarget`/`boostPost`); `/ads/analysis` forwards to Manage. Manage = `AdsManagerTable` (level cards,
  selection with bulk on/off through preview→apply per item, sortable headers via `sort`/`direction`).
- Calendar month: busy days send only 4 posts plus `summary`/`moreCount` (page went 2.9 MB → 0.5 MB). Keep
  client props trimmed (targets: id/type/name/pictureUrl/platformName only).
- Inbox: `AutoOpenFirst` opens the first item needing a reply on ≥1024px when no thread is chosen.
- Approvals is a fixed 4-column board; Queue times show as a week of chips; Help is visible to signed-in members.
- Still open: Queue page ~1.1 MB (per-post hidden details are server-rendered; load them on demand).

### 7.1g Images and history (2026-11-14)
- Uploads: `lib/image-upload.ts` `uploadable()` redraws WebP/AVIF/HEIC and photos over the size limit as JPEG
  (≤ 2048 px) on attach (composer `PostAttachments`, Library `MediaLibrary`). `meta.allowedImageMimeTypes` default
  now includes GIF (Facebook shows it as a still photo).
- One-time history: `syncPageAnalytics` / `syncAdsAnalytics` each read one older block (`BACKFILL_BLOCK_DAYS` = 60)
  per sync in a separate provider window, until `meta.pageBackfillDays` (730) / `meta.adsBackfillDays` (365).
  Progress: `facebook_sync_cursors` kind `page_backfill`; `facebook_ads_backfill` (migration 0013). A Page block
  drops that Page's roll-ups and covering runs so the next roll-up run rebuilds them. Window aborts are not logged.
- Composer channels: > 8 channels use `ChannelSelect` (« Post to » chips + searchable checklist). Sidebar channel
  filter is `ChannelPicker` behind one switcher, shown only on Home, Content lists, Inbox and Insights.

### 7.1h Content feeds and Autopilot screens (2026-11-17), on `main`, live
- Autopilot (`/content/autopilot`): summary card (published today, reached today, planned tomorrow, 7-day reach), « Needs a
  look » list (held or paused channels, failures, low scores, plan to review; each line links to where it is settled), a
  pinned section bar, and one Plan section with a Today / Tomorrow switch (`AutopilotDays`; `#today` / `#tomorrow` open
  a day). `AutopilotBoard` serves both days: by time or by channel, a « Now » line on today, live posts with people
  reached, « Plan a recipe » on a time left empty. `readCockpit` now returns `today`, each post's `status` / `reach` /
  `url`, and each channel's 7-day `daily` reach.
- Content feeds (`/content/feeds`): two tabs, Recipes and Other feeds (`FeedsTabs`, both stay mounted; `#feeds` opens the
  second). The recipe source shows the plan first, grouped by day, with settings behind a Plan / Settings switch
  (`#settings`, and `#autopilot` which also opens that group). Pause / retry moved into a menu; feed rows show a status
  and keep Edit / Delete in a menu.
- Fixed on the way: page 2 of the planned posts showed no times (labels were not refreshed); `--warn` was not a token
  (now `--warning`); `recipeText` falls back to the shipped text when a Root-edited catalog lacks a key.
- A busy day (the live site has 11 channels, 44 posts a day) opens on eight posts around now, the rest behind « Show
  all »; the activity log shows six entries, older ones folded.
- Checked on the live site after deploy (read-only, desktop and 390 px, no page errors), and locally with sample data
  where « leave empty » and « approve all » were run.
- Planned posts (Feeds) list what is to come first, soonest first, then « Already passed », latest first
  (`selectPlans`); on phones each row is a card. A channel trend past ten times the week before reads « ×58 ».
- Autopilot « Needs a look » names the week's last three failures (recipe, channel, time, reason; `readCockpit`
  `failures`). The recipe count (« Recipe supply ») takes about a minute after each deploy because a restart empties its
  in-memory cache: Feeds now refreshes itself (`RefreshSoon`) until it arrives. Not a bug; seen live on 2026-11-17.
- A failed time counts as a problem (Autopilot « Needs a look », Feeds status card) only when it was not left empty or
  replaced on purpose and no planned post on that channel sits within the autopilot gap (`stillFailedSql`). Seen live:
  an interrupted run left 16 Nov 15:00 « not created » after the autopilot had moved that channel's time to 15:30, which
  carried the post.
- Freed slots on a short day (owner's choice by form, 2026-11-17): a `not_created` slot at a time the channel no longer
  uses is revived through `makeup` at the channel's next free time that day (inside the autopilot window, at least the
  gap from its other posts), only when the day would otherwise end with fewer posts than its times; upcoming times the
  run still fills count as posts, so a day is never doubled (`shortDayRefills`, logged as `refilled`).
- Feeds: the separate « Recipe automation » card is merged into the recipe source header as a row of figures (owner's
  choice by form, 2026-11-17; `recipe-figures.ts`). Its unused `recipeStatus*` copy keys stay in `feeds.copy` because
  Root-edited catalogs are validated against them.
- A fragment built with `Prisma.sql` works only when the whole query is a `Prisma.sql` object passed to `$queryRaw(...)`;
  nested inside a tagged `$queryRaw` template it is sent as a JSON value (error 42804).
- Live-site credentials for read-only checks are in the cloud environment as `MSP_APP_URL`, `MSP_TEST_EMAIL`,
  `MSP_TEST_PASSWORD` (never print them); sign in with `POST /api/auth/sign-in` and an `Origin` header.

### 7.1i AI auto-replies to comments and messages (2026-11-17, owner's choices by form)
- Inbox › Rules › « AI auto-replies » (`modules/inbox/components/AiRepliesPanel.tsx`, `modules/inbox/ai-replies.ts`,
  `modules/inbox/server/ai-replies.ts`, `GET/PUT /api/inbox/ai-replies`, migration 0020). Off by default; owners and
  admins switch it on. Choices: comments and Messenger messages; everything except negative, sensitive and spam; only
  after 30 minutes with no reply from the team (15/30/60/120 offered); no daily limit (the hourly AI limit applies).
- Runs after each Inbox sync (`server/jobs/runtime.ts`, after the moderation rules, which take precedence) with an
  active owner's authority. Looks only at what arrived after it was switched on (`enabledAt`), within 24 h (Messenger:
  23 h, inside Meta's window). Links and phone numbers are spam and comments already read as negative go to a person
  without an AI call; otherwise one AI call (`inbox.autoreply`) returns reply / handoff / skip as JSON. A handoff sends
  the existing `moderation_alert` notification. At most 3 AI replies per Messenger conversation per 24 h, then a person.
- Every outcome is claimed first in `moderation_actions` (`ruleId` NULL, action `ai_reply` / `ai_handoff` / `ai_skip`,
  partial unique index `moderation_actions_ai_once_key`), so nothing is answered twice; `replyText` holds what was sent
  or why it was left. A failed send stays claimed (never resent blindly); the AI being unavailable releases the claim.
- Checked locally end to end with a stand-in AI and account (no real send). Not yet run on the live site.
- « Try on recent messages » (`previewAiReplies`, `POST /api/inbox/ai-replies/preview`, owners and admins): what the AI
  would answer to the latest unanswered comments and messages of 24 h, with the settings being edited; nothing is
  claimed, recorded or sent (one AI request per item the rules do not decide).
- Also fixed: `schema.prisma` lacked `facebook_ads_backfill` (migration 0013), so CI's schema check had been failing.

### 7.1j Post figures and per-channel learning (2026-11-18)
- Bug fixed: since 16 Nov the viral radar (`syncPostMetrics`) stores a post's figures on `post_targets` ~2 h after
  publishing; post analytics, post reach and cohorts preferred that copy over `external_posts` (refreshed hourly), so
  every post looked like ~0.2× its channel's usual. Readers now take the copy read last (`post-reach.ts`,
  `post-performance.ts`, `destination-measures.ts`). The autopilot's learning read `external_posts` and was fine.
  Corrected figures: recipe posts ran 1.1–1.6× their channels' usual from 11 to 17 Nov.
- Owner: « the score must be based on what works on each page ». `pageLearning` (server/wordpress-scoring.ts) learns
  per channel from every title word (log of reach vs that channel's median, capped 20×, 30-day half-life, shrunk to all
  channels with k = 3); the picker scores each recipe for the channel it would go to; up to ±20 points.
- Backtest on 1,097 live recipe posts (21 Oct – 17 Nov, three test weeks): within-channel rank correlation of any
  title-based method is only ~0.10–0.13; per-channel, 30 days: top quarter 1.33× vs bottom 1.08× (single first word
  before: 1.28× vs 1.04×). Day × channel explains ~60 % of reach swings; titles explain little. Do not promise more.

### 7.1k The autopilot's memory of each Page (2026-11-18, owner's request)
- `wordpress/memory.ts` (pure) + `server/wordpress-memory.ts` + table `autopilot_memory` (migration 0021). Every
  planning run rebuilds each Page's memory from its settled recipe posts (published ≥ 48 h, last 365 days) and stores
  it. A post's result = reach 45 %, shares 20 %, reactions 20 %, comments 15 %, each as log vs the Page's usual
  (capped 20×); lessons fade with a 30-day half-life; a Page borrows from the others until it has its own evidence (k=3).
- Features: title words, dish kind, hour, weekday, kind × time of day, kind × weekend, « quick »/« easy » titles,
  caption traits (question first/last, emoji, length, hashtags), hook style, and the photo (AI vision: appeal 0–10 and
  traits from `PHOTO_TRAITS`, stored in `recipe_ratings.photoTraits`).
- Used: recipe scoring per Page (`contentValue`, through `history` in the picker), each Page's hook style
  (`bestStyle`) and caption guidance (`captionTips` → `captionPrompt.guidance`), and the Autopilot channel cards.
- Photos: until now photo rating ran two at a time, fire-and-forget, only on runs with empty slots; none showed in the
  live AI usage this month. Now the most promising unseen candidates are read before choosing, and published photos
  are read for learning (12 a run, newest first).
- `POST /api/feeds/wordpress/autopilot/replan` (confirmation `REPLAN WITH PAGE MEMORY`): tomorrow and the day after,
  scheduled > 3 h ahead, recipes the memory expects below their Page's usual are replaced (« another recipe »).
- AI content label: Meta documents reading IPTC/C2PA metadata to show « AI info »; no confirmed Graph API parameter.
  sharp can embed XMP (`withXmp`). Not done: only right if the photos are AI-made — owner to decide.
- 2026-11-18 later: the memory also learns from posts made outside the autopilot (`external_posts` not linked to a
  post target: text as title, Facebook `statusType` as format `f:`, origin `o:app`/`o:external`, Facebook picture read
  for traits under rating id `ext:<external_posts.id>`). Published autopilot photos are read from the app's own media
  library. Posting times come from the memory every day (`memoryModel.bestTimes`: best hours with evidence, spaced by
  the gap; `LEARN_VERSION` 5); the 14-day learner is the fallback.
- Posts per day (owner's request): the memory keeps, per count, how whole days did in total against the Page's usual
  day (`days`, `dayUsual`). `bestCount`: the best count with ≥ 3 days wins; while the current one is best and one more
  has not had 3 days, one more is tried (up to `MAX_POSTS_PER_DAY` = 10). The count sets how many times `bestTimes`
  picks. More posts use recipes faster: watch the recipe supply warning.
- Daily re-plan: from 17:00 local, once a day (audit `feeds.autopilot_replanned` today = done), `dailyReplan` runs the
  same re-planning as the manual action, after the planning run.
- Photo rating never worked before 2026-11-18: `convertToJpeg(..., { maxPixels: 600_000 })` uses maxPixels as sharp's
  input limit, so every 1080 × 1350 photo was refused (« Input image exceeds pixel limit »). The AI copy now uses
  `photoForAi` (resize to ≤ 768 px). `POST /api/feeds/wordpress/autopilot/photos` (confirmation `READ PHOTOS NOW`) reads a
  batch on demand and answers with `{ queued, read, problem }`: live 12/12 after the fix.

### 7.1l Generated photos for weak recipe photos (2026-11-19, owner: « you can also generate new images if necessary »)
- `server/wordpress-photos.ts`. When the autopilot plans a recipe whose own photo the AI rated 7/10 or less for appeal (5 until the figures showed none that weak),
  it generates a photo of the dish (studio image service: `ai.imagePolicy`, AI budget, hourly limit) in the photo traits
  that work on that Page, stores it as a JPEG with the AI tag, and posts it. At most 12 in 24 h per workspace (6 until the owner raised it) (audit
  `autopilot.photo_generated`). Any problem: the recipe's own photo goes out.
- The plan row records `imageSource` (`site` / `generated`, migration 0022); the memory learns it as `g:<source>`.
  `generatedPhotosOk`: once a Page has 5 settled posts of each, generated photos stop there if they do ≥ 15 % worse.
- Queued posts too (2026-11-19): each planner run, a queued recipe post going out in 3 h–3 days with a title rated
  ≥ 7 and its own photo ≤ 5 gets a generated photo: made first, then the post goes back to draft, takes it and is
  scheduled again at the same time (re-scheduled as it was if the change fails). Same daily cap and Page stop rule.

### 7.1m Hit content on every Page (2026-11-19, owner's choice)
- Reach is all in the hits (median post 61, top 401k). Each choosing run reads the 30 biggest posts of the last 60 days
  on the source's Pages (`hitPosts`, app and outside posts) and keeps the title words in ≥ 2 of them (`hitWords`:
  fromage, jambon, saumon fumé, gaufre, terrine, quiche…). A recipe's expected value on any Page is multiplied by
  `hitBoost` (×1 with none, up to ×2), on top of that Page's own memory.
- AI photos are off (`ai.imagePolicy.enabled` false) since the owner judged the studio-style photos not viral: the posts'
  real Facebook pictures are step-by-step collages (4 steps + big final shot), as are 11 of the top 12. Collage examples
  were shown and approved (19 Nov): `photoPrompt` now asks for that collage (ingredients, 3 steps, big final shot at its
  most tempting moment), and generation is back on.

### 7.1n « AI info » on Facebook (2026-11-19)
- The IPTC marker in the photos (`labelPhotosAsAi`) did not make Facebook show « AI info »: Meta does not document reading
  it on API uploads. Graph API v27.0 (4 Nov 2026) added `is_ai_generated`, accepted only when editing an existing post
  (`POST /{post-id}`). `discloseAiGenerated` (Facebook client) sends it through v27.0 for that call only (the app stays on
  `meta.graphVersion`). `server/wordpress-ai-disclosure.ts` marks the autopilot's recipe posts published in the last 7
  days, once each (audit `autopilot.ai_disclosed`), after each planner run while `labelPhotosAsAi` is on; the first
  failure stops the batch and is logged (`aiTagFailed`, once a day).
- 2026-11-19 (owner): photos are kept as downloaded from WordPress. A JPEG within `maxOutputBytes` is stored and posted
  byte for byte; WebP/PNG (or too large) is converted to JPEG with nothing added. No AI marker is written into any photo
  any more; « AI info » comes only from `is_ai_generated` on the published post.

### 7.1o Photo rating v2 (2026-11-20, owner: image realism and attractiveness drive virality)
- v1 asked one 0–10 « appeal »: 499 of ~600 recipes got 8. v2 (`PHOTO_VERSION` 2, column `recipe_ratings.photoVersion`,
  migration 0023) rates realism, appetite, final shot and « stops the scroll », combined 0.3/0.25/0.15/0.3 into the same
  0–10 `photo`, minus 1.5 per defect (title_text, ingredient_graphic, ai_artifacts, blurry, dark). Brightness is measured
  on the pixels (`bright_image` ≥ 140, `dim_image` < 115) so Page memories can learn it. Older ratings are re-rated.
  The photo now weighs ±20 points (was ±15).
- What the data showed before building (owner should know): on « Recettes - Faciles »' 15 best vs 15 weakest posts, the
  AI judge scored 70.6 vs 66.7 and brightness 134 vs 127 (correlation with reach 0.18): small. The clear image signal is
  posters (title text + ingredient graphic): 3 of the weakest vs 1 hit. Dish type (cheesy, golden, ham/cheese bites)
  separates hits from weak posts more than how the photo is made.

### 7.1p Navigation: « Pilote automatique » hub (2026-11-20, owner's choice)
- New sidebar hub `pilot` (src/lib/hubs.ts), second after Create, on the phone bar too (« Pilote »): tabs
  « Pilote automatique » (`/content/autopilot`, the cockpit) and « Recettes et flux » (`/content/feeds`, which left
  Contenu's tabs). It uses the content-feeds feature (`publishing/feeds`); no route, feature or permission changed.
- Scope agreed with the owner: only the autopilot moves while Meta's App Review runs; the screens in the review
  recordings (composer, posts, Inbox, Insights, Ads, Channels) are unchanged. After approval: the wider clean-up
  (Contenu's tabs; the owner uses Inbox & AI replies, Statistics, Ads, and not manual posting).

### 7.1q Failed times, negative comments, inbox sync budget (2026-11-21)
- A failed slot is history, not a failure, when it was cancelled or replaced, or when its channel's day still got its
  full count of planned posts (the autopilot moves times nightly): `settledFailures()` in feeds/wordpress/autopilot.ts,
  used by the cockpit's Today list, each channel's « failed this week » and the « À regarder » list.
- AI replies (owner's choice): a comment read as negative is no longer handed off by `precheck()`; it reaches the AI with
  a stricter line (reply only to a calm remark, preference or correction about the recipe). Negative private messages
  still go to a person.
- Root config `sync.resourceOperationTimeoutMs` raised 60000 → 180000 (live, 21 Nov ~07:40 UTC): the worker's inbox
  and analytics syncs save each Page inside `withSelectedResourceOperation`, and busy Pages were cut off (`AbortError` in
  facebook.inbox / facebook.pageAnalytics). 180000 + maxWait 2000 + grace 5000 stays under
  `data.workspaceOperationTimeoutMs` (300000). (A first change to `inbox.commentOperationTimeoutMs`, which only guards
  members' comment actions, was the wrong key and was put back to 60000.)
- Fonts ship with the app (`src/app/fonts`, next/font/local): next/font/google failed CI builds now and then.
- Title-only caption test (owner's choice, 21 Nov → 26 Nov): `captionTitle: true` on Recettes Sans Complication, Recettes
  Sans Routine and Recettes Sans Soucis; controls with similar reach: Cuisine Qui Réunit, La Cuisine Décontractée,
  La Cuisine Ensoleillée. Why: on Recettes - Faciles, posts published by another tool (title-only captions) reached 1.17M
  people over 14–20 Nov (median 12.5k) vs 172k (median 3.4k) for the autopilot's posts there. Only RF has such posts.
- Incident (21 Nov, 07:21 UTC): a probe saved the source with `config: {}`; the save replaces the config, so settings fell
  to defaults and the learned data (times, hour values, radar handled list, log) was dropped. Settings were restored from a
  copy taken minutes before; the planner relearned the times at 07:30; the radar's handled list and the log are lost (a
  hit of the last 10 days may be spread once more, only to Pages without that recipe). Fix: `keepLearned()` keeps learned
  data on every save. Never probe write endpoints with partial bodies on the live site.
- Open: on 21 Nov 07:18–07:23 the live PUT /api/feeds/wordpress answered an HTML 500 for the full config (learned data
  present), not reproducible locally with the same config; saves work again since the relearn. Recheck if it recurs.

### 7.1r Choosing viral content: learn, explore, promote (2026-11-21, owner's choices by form)
- Photo check (`featureLessons`, GET /api/feeds/wordpress/autopilot/photos → `lessons`): the AI's overall appeal did not
  follow reach (low ×1.11, mid ×1.01, high ×1.08); traits did (cheese_pull ×1.31, melting ×1.16, steam ×1.13). The photo
  part of the score now comes from `photoValue` (learned trait value, log × 40, ±20); `photoWeak` (< 0.98, or appeal ≤ 5
  with nothing learned) decides photo generation, the queued-photo upgrade and the replan.
- Radar: a strong early hit (5× its Page's usual at that age, ≥ 300 people) and a late hit go to the two biggest Pages
  first, then up to `radar.pages` (5) under the usual rule (`spreadTargets`).
- Top hits come back on their Page after 30 days (`autopilot.evergreen.cooldownDays` 60 → 30, live).
- Dish families (`familiesOf`, ~20) are a memory feature (`fam:`), weight 1.5 in `contentValue`; first live values:
  terrine ×1.34, quiche/tarte salée ×1.24, viennoiserie ×1.19 … sablé/biscuit ×0.82.
- Testing ground: every Page except `bigPages(2)` gives up to 15 points to recipes new to all Pages (`novelty`, families
  with < 10 learned posts). Winners move up through the radar.
- Forms never send the autopilot's learned keys (`AUTOPILOT_LEARNED_KEYS`, `configPatch`): live full saves carrying them
  got an HTML 500 (cause not found); the server keeps its own copy anyway (`keepLearned`).
- Top-hits study (21 Nov, 1,625 posts since August): the top 1% (16 posts) made 36% of all reach, the top 30 made 45%;
  27 of the top 30 are title-only RF posts from another tool (the WordPress title, 42–74 characters, no emoji: « Camembert
  feuilleté au bacon, doré et fondant » 1.24M). Owner's choice: Recettes - Faciles is `captionTitle` from 21 Nov ~12:00
  UTC; Cuisine Pleine d'Envie keeps written captions as the big-Page comparison.
- Posts deleted on Facebook (21 Nov): `post_targets."remoteMissingAt"` and `external_posts."remoteMissingAt"` (migration
  0024), set by `markPostMissing` (src/platforms/facebook/remote-missing.ts) on Graph 100/33 in the inbox syncs or a feed
  webhook with verb « remove »; cleared when the Page feed shows the post again. Excluded from comment syncs, first
  comments, « AI info », Page memory, hit words, radar, Inbox list/badge and AI replies; the Autopilot page shows
  « Supprimée sur Facebook ». The 13 « (#100) permission » refusals of the AI label were deleted RF posts. Posts and
  Insights screens unchanged while Meta's review runs (a marker on the Posts list can come after approval).
- « AI info » on every autopilot post (21 Nov): no 7-day window any more, 60 a run, a refusal retried once a day later;
  backlog of ~890 done the same night (1,306 / 1,306). `aiLabel` in GET /api/feeds/wordpress/autopilot/photos.
- Captions: CLICHES (« la famille se retrouve », « autour de la table »…) named in the prompt, a caption using one is
  rewritten once (`clicheIn`); the « story » hook asks for a concrete moment, not a family scene.
- Plaisirs en Cuisine (added 21 Nov): own first comment « 🍽️ {title} / 👉 {link} » (owner: link, no « La recette
  complète : »); written captions; testing-ground Page.
- Queued posts of a channel switched to `captionTitle` are retitled by the planner (`retitleQueued`, 20 a run).
- Manual vs app (22 Nov): the RF posts called « another tool » above are the owner's own posts from the Facebook phone
  app. `reachByOrigin` (wordpress-origins.ts, `origins` in GET /api/feeds/wordpress/autopilot/photos) gives per Page, over
  30 days, median reach and × usual for: Facebook's scheduler (`nativeScheduledFor`), held by the app, outside. RF: manual
  25.4k (×1.05, 172 posts) vs app 8.6k / 6.5k (×0.35 / ×0.27, 12 posts). Scheduler vs held: scheduler better on the Pages
  with real reach (CPE ×1.79 vs ×0.53), held « better » only on Pages at 30–60 people (noise); not a clean test.
- Migration 0025 (feed copies take the app's post id when only the prefix differs) was a no-op live: ids already match on
  every Page. Kept as a guard; the feed sync and webhooks map by post part (`postPart`).
- Reach at fixed ages (22 Nov, migration 0026): `external_posts."reach3h"` (read at 2–5 h) and `"reach24h"` (22–30 h),
  set once by the hourly Page feed sync (`reachAtAge` in remote-missing.ts), every feed post including manual ones.
  `origins` adds at24h / read24h; `atAge` (photos figures) lists each post of 10 days with both readings. Use them for
  every test read (the 22 Nov read compared a 1-day-old post with week-old ones). Radar `expectedAt` recalibrated on
  23 Nov from them: 10 % at once, 50 % at 3 h, 100 % at 24 h (measured: 46 % of the day's reach at 3 h, RF 24 %; it
  assumed 100 % at 3 h). Re-check with more readings.
- Owner's manual posts repeated by a queued autopilot post are replaced each run (`replaceOutsideRepeats`, 7 days,
  posts more than 3 h away, 5 a run; log « repeatReplaced »). Owner's own biggest hits (≥ 50k and 5× usual, older
  than 30 days) join the evergreen winners, exact recipe by WordPress search or its closest variant (`recipeByTitle`,
  `closestVariant`).
- Competitors to read after Page Public Content Access: magickitchen038, cookikitchen1, mabonnerecette92 (behind
  Facebook's login on the web; owner chose to wait for the permission).
- AI replies (22 Nov): a request for the recipe always gets the link, even impatient; ingredient / quantity / time /
  step questions are answered only from the post and recipe text, else handed off (« beurre » reply had explained a
  photo). Owner's « fix all »: the handed-off « Où est la recette… SVP » on the pains aux raisins post was answered
  with its link by hand; the photo-mismatch complaint on RF is left to the owner.

### 7.1s Audit (22 Nov 2026, owner: « deep audit and improve all features except screens under Meta review »)
- Fixed: Page feed sync merges post insights (stored || new), so a metric Facebook refuses on one read (HTTP 500 on
  post_total_media_view_unique) keeps its last value instead of erasing the post's reach.
- Fixed: scheduled inbox sync read every published post of every Page every 2 minutes (run 449 s, never fresh);
  `inboxPostDays`: 3 days each run, 14 days every ten minutes, 60 days hourly → runs 76–87 s, fresh.
- Root › Errors: 45 entries last seen before 22 Nov with fixed causes were resolved (a recurrence reopens them).
- Open, owner's side: no off-site backup and no restore test ever recorded (local dumps daily are fine); operator alerts
  have no destination (`chatWorkspaceId` empty), the 11 Nov « backup.failed » alert stays open; unused platforms
  (Instagram, YouTube, TikTok…) report missing keys, expected.
- Left as is: 293 pre-existing lint warnings (266 unused vars), mostly in Publishing / Insights / Ads screens under
  review; hook warnings there too; AppShell scope effect re-runs each render but only rewrites a cookie when needed.
- Backups (22 Nov): `backup.sh --restore-test` restores the newest dump into `<db>_restore_test`, checks users/posts/
  post targets/recipe plans, drops it and records « restore_test » in Root › Backups; weekly timer
  social-pilot-restore-test (Sun 04:47), enabled by the deploy script once the installed backup.sh knows the option
  (run `socialpilot-deploy` on the server once). Off-site copy needs BACKUP_RSYNC_TARGET in
  /etc/ms-social-pilot-backup.conf (owner's destination). « backup.failed » is open by design until an off-site backup
  succeeds. Operator alerts are emailed to the owner (sent since 21 Nov); chatWorkspaceId only adds team-chat delivery.
- RF first-comment test (owner's choice, 23 Nov): with the same title-only captions and site photos, the owner's manual RF
  posts reached 2–4× more at 24 h (22 Nov). From 24 Nov 08:35 RF is `plainComment` with template « 👉 {link} » (no
  recipe text, no call to action), queued posts rewritten (`recommentQueued`). Read on 27 Nov 15:10 Paris at 24 h.
- Root › Errors: 114 more stale entries resolved on 23 Nov (the API pages by 50); 8 open, all current.

### 7.1t Reach drop and the reach test (24 Nov 2026, owner: « reach dropped a lot, fix urgently »)
- What dropped: mostly the end of Cuisine Pleine d'Envie's viral streak (Page reach 473k on 19 Nov, 665k on 20, 219k
  on 21, 22k on 22; about 3–4k a day before the streak). Every Page's new posts are weaker too.
- Posts of 20–23 Nov were published by the app instead of Facebook's scheduler (56 of 61 on 22 Nov). Their hand-off
  at creation (48 h ahead) failed silently: every `holdScheduledPostAtProvider` caller swallows the error. Cause not
  identified; since 23 Nov 17:00 UTC hand-offs work again. Fixes: each planning run calls `handOffRemoteSchedules`
  (log code `reheld`); a refused hand-off is recorded in Root › Errors (`publishing.remoteHold`). Posts going back
  through the scheduler did not lift reach (24 Nov morning, same Page and hour: mostly lower than 23 Nov).
- Owner's 2-day reach test (form, « Both, on separate Pages »), from 24 Nov 14:20 UTC:
  - no « AI info » edit (`ChannelSettings.noAiLabel`): La Cuisine Ensoleillée, Nos Recettes Généreuses, Les Recettes
    Complices;
  - 4 posts a day (`ChannelSettings.maxPerDay`, keeps the hours with the best learned value; learning respects it):
    Cuisine Qui Réunit, La Cuisine Tranquille, La Cuisine Décontractée (were 6; 12 queued posts at dropped times
    cancelled and deleted);
  - unchanged: the title-only Pages (Sans Soucis, Sans Routine, Sans Complication), RF, CPE, Plaisirs en Cuisine.
  - Verdict scheduled 27 Nov 16:40 Paris. Do not extend either change without the owner's answer.
- The extra posts a day came from the Page memory (`model.bestCount`), not from a member: learned times give 4–6 a day.
- Also fixed on 24 Nov: AI limit stops a planning run at the first refusal (`ai_limit`); Facebook insight reads stop at
  a « next » link past the asked window (page_follows backfill blocks failed at the page limit); a slot whose post was
  deleted is released like a withdrawn draft; a first comment cut off mid-send is settled after 30 min (Page's own
  comment found → id recorded; none while the sync read the Page since → released and resent; else left); AI replies
  are told the Page's last 8 replies (no repeated wording) and that the Page is « nous » (« ravis »).
- Root › Errors: 28 entries resolved on 24 Nov (pageBackfill pagination, Facebook's 09:15–10:30 UTC outage); 7 open.
- Reach analysis (25 Nov, 1,032 autopilot posts of 26 Oct–22 Nov with reach): a typical app post, relative to its Page's
  median, was 0.74–0.94× on 1–10 Nov, 0.9–1.5× on 11–21 Nov and 0.98× on 22 Nov, so no collapse per post; the drop in
  totals is the end of the viral run (CPE 18 Nov). Cross-Page repeats are 6% of posts (distinctAcrossPages) and do
  slightly worse (median 0.90× vs 1.00× for a recipe's first Page). Owner chose « site photos only » from 28 Nov
  (`autopilot.photos.generate`, switched off on 26 Nov 00:30 Paris since posts are planned 48 h ahead).
