# AGENT.md — MS Social Pilot (`v1.0.0`)

Compact, high-signal guide for AI coding agents. Read this file first to understand the entire codebase with minimal context usage.

## 1. Repository Layout

All application code lives in `app/` (`ms-social-pilot@1.0.0`, Next.js 15 App Router, React 19, TypeScript, Prisma, PostgreSQL):

- `app/src/app/` — Next.js pages and thin HTTP route handlers (`/api/**`).
- `app/src/components/` — Shared design system (`AppShell`, `CommandPalette`, `DataTable`, `Select`, `Tabs`, `Drawer`, `Dialog`, ECharts wrappers).
- `app/src/styles/` — CSS token system (`tokens.css`, `shell.css`, `components.css`, `responsive.css`) with 8 light/dark palettes (`vivid`, `meta`, `warm`, `clean`).
- `app/src/modules/<module>/` — Domain modules (`home`, `publishing`, `inbox`, `analytics`, `ads`, `studio`, `media`, `feeds`, `tasks`, `agency`, `sharing`, `integrations`, `notifications`, `settings`, `root`, `shell`):
  - `manifest.ts` — Routes, navigation hub placement, feature IDs, and background job schedules.
  - `config.ts` — Typed Root settings and bilingual (`en`/`fr`) UI copy catalogs.
  - `mcp.ts` — MCP tool definitions and confirmation requirements.
  - `server/` — Shared domain services called by UI, REST, and MCP.
  - `ui/` — Module React components.
- `app/src/platforms/<provider>/` — Isolated social network adapters (`facebook`, `instagram`, `youtube`, `tiktok`, `linkedin`, `x`, `threads`, `pinterest`, `bluesky`, `mastodon`, `telegram`).
- `app/src/server/` — Auth, RBAC, job leases, mail outbox, audit logging, and GDPR export/erasure (`data-control/`).
- `app/prisma/` — `schema.prisma` and the single initial SQL schema migration (`prisma/migrations/0001_init/migration.sql`).
- `app/scripts/` — Only 2 files:
  - `deploy.sh` — Unified script for fresh server install, production updates, and CLI admin recovery (`--local`, `--set-root <email>`, `--reset-2fa <email>`).
  - `worker.ts` — Background job worker (`npm run worker`).

## 2. Core Rules & Conventions

1. **Shared Service Boundary**: UI actions, REST routes (`/api/**`), and MCP tools must call the same domain service in `src/modules/<module>/server/`, enforcing workspace scope, RBAC, and audit logging.
2. **Platform Neutrality**: Product modules (`src/modules/*`) never branch on specific social networks; provider logic stays inside `src/platforms/<provider>/`.
3. **Design Tokens & Bilingual Copy**: Use CSS variables from `src/styles/tokens.css` (never hardcode hex colors in components) and keep user-facing copy in module `config.ts` (`en`/`fr`).
4. **Additive Migrations**: Add new schema changes as new numbered SQL folders in `app/prisma/migrations/` (e.g. `0002_<name>/migration.sql`).

## 3. Verification Commands

Run from `app/`:

```bash
npm run typecheck                  # TypeScript strict check (tsc --noEmit)
npm run build                      # Production Next.js build
```

## 4. Production Environment & Deployment

- **Public URL**: `https://social.newsgeet.com`
- **Production Host**: `root@213.246.45.75` (SSH key `~/.ssh/SebMouadSSH`)
- **Server Paths**:
  - Live app: `/srv/ms-social-pilot/app` (previous release: `/srv/ms-social-pilot.prev`, incremental build cache: `/srv/ms-social-pilot-build/app`)
  - Env file: `/srv/ms-social-pilot/app/.env.production.local` (mode `600`)
  - Services: `social-pilot` (web on `127.0.0.1:3100`) and `social-pilot-worker`
- **Deploy / Update Command**:
  ```bash
  bash app/scripts/deploy.sh
  ```
