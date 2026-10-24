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

Before committing or deploying any change, always run from `app/`:

```bash
cd app
npx prisma generate
npm run typecheck
npm run build
```

To deploy to a remote server when requested by the user:
```bash
bash app/scripts/deploy.sh --host <SERVER_IP> --user root --key <SSH_KEY_PATH>
```
