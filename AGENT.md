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
