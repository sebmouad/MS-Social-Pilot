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
- All database tables use clean, unprefixed names (`job_leases`, `sync_runs`, `notifications`, `publication_attempts`, `workspace_exports`, `export_file_cleanups`, `channel_profiles`, `chat_deliveries`, `writing_agents`, etc.). Never introduce `rebuild_` prefixes.
- When adding a schema change:
  1. Update `app/prisma/schema.prisma`.
  2. Create a new timestamped or numbered SQL migration under `app/prisma/migrations/`.
  3. Run `npx prisma generate` and `npm run typecheck`.

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
  build apart, run `npm test`, apply SQL migrations in `app/prisma/migrations/`, switch releases, check health and roll
  back on failure. They also install the updater timer.
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

### 7.1b Review-readiness pass (2026-11-10), on branch `claude/elegant-brown-5fjxyf`, not merged or deployed

Public front page at `/` for signed-out visitors (`LandingPage` in `modules/history/ui/public-pages.tsx`, text in
`modules/history/public/landing-copy.ts`; signed-in people still land on `/home`). Sign-in pages link to the privacy
policy, terms and data deletion. One product name everywhere: « MS Social Pilot » (sidebar, sign-in, public pages).
Home cards, Channels empty state, calendar empty note and inbox pager tidied. Auto-update follows `main`: merge first.

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
