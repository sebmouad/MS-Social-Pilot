# MS Social Pilot: handbook

MS Social Pilot is a self-hosted social media scheduler and analytics tool for
agencies that run many Facebook Pages, plus Instagram, Bluesky, Mastodon,
LinkedIn, Threads, X, Pinterest, YouTube, TikTok and Telegram. It is a generic
product, to be hosted and sold as a service: any niche, country or language.
Users define their own audiences, calendars, categories and content, so nothing
in code, copy, defaults or docs may be specific to one niche, country or customer.

The code is the source of truth. These documents describe it as it is; update
the matching file in the same commit when a change makes one wrong.

| File | What it covers |
|---|---|
| [FEATURES.md](FEATURES.md) | Every screen and what it does |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the app is built: routes, data, worker, connectors, selection, auth |
| [PERMISSIONS.md](PERMISSIONS.md) | Root, workspace roles and privileges (audited by the owner) |
| [QUALITY_AUDIT.md](QUALITY_AUDIT.md) | Release-quality evidence, remaining checks and AI-agent handoff |
| [INTERNAL_STANDARDISATION.md](INTERNAL_STANDARDISATION.md) | Shared logic, interaction contracts and cross-screen review matrix |
| [DESIGN.md](DESIGN.md) | UI rules, tokens, components, copy |
| [OPERATIONS.md](OPERATIONS.md) | Tests, settings, deploy, rollback, backups, recovery |
| [META_API_NOTES.md](META_API_NOTES.md) | Facebook and Instagram Graph API facts, app setup and App Review |
| [PLAN.md](PLAN.md) | What is still open: blocked items and known gaps |

## Modules

The signed-in app has a narrow icon rail on the left with the areas, a sidebar
with the pages of the area in use (and the channel selection), and a slim top
bar for utilities only.

- **Home**: dashboard, getting-started checklist, Pages hub, monthly goals.
- **Publish**: composer, calendar, queue and content mix, posts, approvals,
  templates, design editor, content sources (RSS and WordPress), key dates and
  trends.
- **Inbox**: comments, messages and reviews in one stream, saved replies,
  moderation rules, response time.
- **Analytics**: Summary, Posts, Audience and Compare views over the selected
  channels, caption tests, link clicks, campaigns, reports.
- **Ads**: ad account results.
- **Workspace**: channels (connections), team and roles, tasks, client links,
  agency view for owners, workspace settings.
- **Root** (the first registered user only, opened from the account menu):
  a separate section under `/root` with **Settings** (site address, AI
  providers, storage, email, security, general, plans, sign-ups),
  **Platforms** (Meta and each other network: switches, credentials, usage,
  every connection with its token health), people (workspaces, users, agency,
  privileges, sessions), health (status, worker, errors, alerts, backups) and
  history (activity, changelog), plus a danger zone.

Root can switch analytics, ads and publishing areas, plus individual
`publishing/*`, `analytics/*`, `ads/*` and `settings/*` features, off per
workspace or member. Plans select the same features and additional platforms;
Facebook remains the initial platform. Root separately turns developer
features (API keys, MCP, webhooks) on per workspace. See
[MODULAR_PRODUCT.md](MODULAR_PRODUCT.md) for the migration contract.

## Stack

Next.js 15 App Router (React 19, server components first), TypeScript strict,
Prisma 6 on PostgreSQL 15, Tailwind 3 (tokens in `tailwind.config.ts`,
component classes in `src/app/globals.css`), next-intl (`messages/en.json`,
`messages/fr.json`), Vitest, Playwright. A separate worker process
(`scripts/worker.ts`) runs publishing and every background job.

## Folder map

| Path | What |
|---|---|
| `src/app/(app)/` | Signed-in screens, inside `AppShell` and `ConfirmProvider` |
| `src/app/(root)/root/` | Root section, inside its own `RootShell` |
| `src/app/(auth)/` | Sign-in, registration, password reset, email check, two-step |
| `src/app/api/` | Route handlers wrapped in `route()` (`src/lib/api.ts`); public API in `api/v1` and `api/mcp` |
| `src/app/share`, `bio`, `l`, `invite`, legal and site pages | Public pages |
| `src/lib/` | Server and shared logic (posts, analytics, inbox, reports, auth, plans, settings) |
| `src/lib/facebook/` | Graph client, budget, publish strategies, insights, metric catalogue, OAuth, permissions |
| `src/lib/networks/` | One connector per other network, plus the registry and connect flow |
| `src/lib/scheduler/` | Publishing runner, retries and the worker job table |
| `src/lib/settings/` | Runtime settings registry, edited by root |
| `src/components/` | UI components; `charts/`, `analysis/`, `ads/`, `root/` subfolders |
| `prisma/` | `schema.prisma` and additive migrations |
| `messages/` | All UI text, English and French |
| `tests/`, `e2e/` | Vitest suites and the Playwright browser walk |
| `scripts/` | Worker, start, setup, Debian install, deploy, admin recovery, dev helpers |
| `.claude/skills/` | Task skills for agents (see below) |

## Conventions

- Server components fetch; client components (`'use client'`) only handle
  interaction. A client component never imports `@/lib/prisma` or anything that
  reaches it; shared constants live in plain modules (`src/lib/palette.ts`,
  `src/lib/network-rules.ts`, `src/lib/report-sections.ts`, `src/lib/selection.ts`).
- Errors for users: `AppError` with a message key translated in both
  catalogues (`src/lib/errors.ts`). Validation with zod at the route boundary.
- Every query that lists Pages or posts goes through the member's Page scope
  and the shared selection (`src/lib/page-access.ts`, `src/lib/page-filter.ts`).
- Times are stored in UTC and shown in the workspace time zone.
- Activity is logged with `logActivity`; root actions go to the root log.
- Every UI string goes in both message files with the same placeholders;
  anything that counts uses ICU plurals.
- Confirmations use `useConfirm()`, never `window.confirm`.
- Comments explain why, in full sentences.
- Commit straight to `main`, with a message describing the user-visible change.

## Commands

```bash
npm run dev            # web app on :3000 (needs .env)
npm run dev:worker     # worker, restarts on change
npx tsc --noEmit       # typecheck
npm run deploy         # ship main to production (see OPERATIONS.md)
python3 scripts/dev/add-messages.py new.json   # merge {"en":{...},"fr":{...}} into both catalogues
```

Tests, the test database and the browser walk are in [OPERATIONS.md](OPERATIONS.md).

## Skills

Project skills in `.claude/skills/` hold the step-by-step for recurring tasks.
Load the one that matches before starting.

| Skill | Use it for |
|---|---|
| `frontend-design` | Any UI work |
| `profile-selection` | Any screen, query, export or API that lists channel data |
| `analytics-dashboard` | Analytics views, KPI cards, aggregation, reports data |
| `ux-copy-house` | Buttons, errors, empty states, confirmations in both languages |
| `run-tests` | Before and after every change |
| `deploy-production` | Shipping or rolling back |
| `live-facebook-test` | Checking on real Facebook with the test Page (owner's OK) |
| `db-migration` | Changing `prisma/schema.prisma` |
| `add-network-connector` | Adding a network |
| `meta-api-integration`, `debug-access-token`, `api-health`, `webhook-setup`, `debug-webhooks`, `search-meta-docs` | Graph API work |
| `app-review-prep`, `app-health-check`, `compliance-check` | Meta App Review, app settings, policy |

Reviewed third-party skills sit beside them: `playwright-expert`,
`secure-code-guardian`, `web-design-guidelines`, `vercel-react-best-practices`,
`vercel-composition-patterns`. They are generic advice; this repository's
rules win where they differ (for example: no Page Object classes or
`data-testid` in e2e, follow `e2e/helpers.ts`; route handlers use `route()`
and zod rather than Express middleware; sentence case, not Title Case).
