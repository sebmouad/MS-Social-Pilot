# MS Social Pilot — Architecture (v1.0.0)

MS Social Pilot is a modular, multi-workspace social media publishing, engagement, analytics, and paid-media management platform located in `app/`. It follows the rules pinned in [ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md), [API_V1.md](API_V1.md), and [MCP_PARITY.md](MCP_PARITY.md).

## Core Architecture Principles

1. **Unified Service Boundary (UI / REST / MCP Parity)**:
   - Every user-facing capability enters the same domain service in `src/modules/<module>/server/`.
   - Domain services enforce current authentication, workspace membership, role permissions, plan entitlements, explicit confirmation phrases, and audit logging.
   - HTTP routes (`src/app/api/**`) and MCP tools (`src/modules/<module>/mcp.ts`) are thin transport adapters over these shared services.
2. **Modular Platform Isolation**:
   - Product modules (`src/modules/*`) never hardcode social network protocols or provider branches.
   - Platform modules (`src/platforms/facebook`, `src/platforms/instagram`, `src/platforms/youtube`, `src/platforms/tiktok`, `src/platforms/linkedin`, `src/platforms/x`, `src/platforms/threads`, `src/platforms/pinterest`, `src/platforms/bluesky`, `src/platforms/mastodon`, `src/platforms/telegram`) implement neutral host contracts registered through `src/server/platforms/`.
3. **Typed Root Configuration**:
   - All operational settings, limits, schedules, feature gates, and bilingual EN/FR copy catalogs are declared in module `config.ts` files and aggregated in `src/lib/config/registry.ts` (current schema version **142**).
   - Secrets are encrypted at rest with AES-256-GCM envelopes and managed in `/root/config`.
4. **Full Data Control (Export & Erasure)**:
   - Every workspace-owned and user-owned table is cataloged in `src/server/data-control/README.md`, protected by cascading foreign keys and workspace purge write-gate triggers (`rebuild_reject_purging_workspace_write()`).

## Source Layout (`app/`)

| Path | Responsibility |
| --- | --- |
| `src/modules/<module>/manifest.ts` | Module routes, navigation hub placement, feature entitlements, Root namespaces, and background job declarations |
| `src/modules/<module>/config.ts` | Zod-validated Root configuration declarations and default EN/FR copy catalogs |
| `src/modules/<module>/mcp.ts` | MCP tool definitions, confirmation phrases, and scope metadata |
| `src/modules/<module>/server/` | Domain services, queries, and mutations shared across UI, REST, and MCP |
| `src/modules/<module>/ui/` | Client and server UI components for each product module |
| `src/platforms/<provider>/` | Provider OAuth, token renewal, publishing formats, inbox sync, analytics, and ads adapters |
| `src/server/` | Shared authentication, RBAC, job leases, mail outbox, audit logging, and data-control pipelines |
| `src/components/` | Shared design system components (`AppShell`, `DataTable`, `Select`, `Tabs`, `ConfirmDialog`, charts) |
| `src/styles/` | Design tokens (`tokens.css`), 8 light/dark theme palettes (**Vivid**, **Meta blue**, **Warm**, **Clean**), and module styles |
| `prisma/` | `schema.prisma` and additive SQL migrations (`20261103000000_baseline` through `20261103050000_platform_moat`) |

## Navigation Hubs & Product Modules

The application shell (`src/components/AppShell.tsx`) organizes features into 5 primary hubs plus workspace settings and instance administration:

- **Create**: Home Overview (`/home`), Composer (`/content/composer`), Media Library (`/content/media`), AI Studio (`/content/ai-studio`)
- **Plan**: Posts & Queue (`/content/posts`), Calendar (`/content/calendar`), Approvals Pipeline (`/content/approvals`), Automated Feeds & WordPress Recipes (`/content/feeds`), Tasks (`/tasks`)
- **Engage**: Unified Social Inbox (`/inbox`) with comments, DMs, reviews, saved views, full-text search, and automated moderation rules
- **Measure**: Insights Overview, Explorer, Channel Comparison, Goals, Pinned Views, Scheduled Reports, Metric Alerts (`/insights/*`), and Caption A/B Tests (`/insights/tests`)
- **Grow**: Writing & Autopilot Agents (`/content/agents`), Ads Overview, Explorer, Comparison, and Campaign/Ad-Set/Ad/Creative Manager (`/ads/*`), Sharing & Bio Links (`/sharing`), Agency Client Hub (`/agency`)
- **Workspace & Root**: Channels, Profiles, Team, Security, Appearance, Notifications, Data Controls, Integrations (`/settings/*`), and Instance Administration (`/root/*`)

For planned UI and UX enhancements, see [UI_UX_ROADMAP.md](UI_UX_ROADMAP.md).
