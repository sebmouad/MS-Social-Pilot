# MS Social Pilot — handbook for AI agents

## Objective

A **SocialPilot / Simplified / Metricool-class** social media tool, to be
**hosted and sold as a service** once complete. It is **generic**: any niche,
any country, any language — users define their own audience, categories,
calendars and content. Never build anything niche- or country-specific, and
never use the owner's own Pages or sites as product examples (they are only the
live-test data, see STATUS.md). Final goal set by the owner: **every feature competitors have, with
elegant design, Facebook-like visuals and perfect UX** — verified in a real
browser with real data.

Jobs the app does, in order of importance:
1. **Publish**: write once, post to many Pages (and other networks) now, at a
   time, in a queue slot, or held by Facebook; first comment; Reels/Stories;
   approvals; client review links.
2. **Analyse**: per-Page analysis (health score, KPIs vs previous period or a
   year earlier, best times, top posts), every Graph metric, audience map,
   reports (PDF, templates, scheduled email).
3. **Run a team / agency**: workspaces (clients), roles, per-Page access, groups,
   labels, client portal, Slack/Telegram alerts, API + MCP for Claude.

Owner: Mouad Sebhaoui (sebhaoui.m@gmail.com). Languages: English and French
(UI), content mostly French. Production: https://social.newsgeet.com.

## Stack

Next.js 15 App Router (React 19, server components first), TypeScript strict,
Prisma 6 + PostgreSQL 15, Tailwind 3 (custom tokens in `tailwind.config.ts`,
component classes in `src/app/globals.css`), next-intl (`messages/en.json`,
`messages/fr.json`), Vitest, Playwright. A separate **worker process**
(`scripts/worker.ts`) runs the scheduler and sync jobs.

## Map of the code

| Path | What |
|---|---|
| `src/app/(app)/*` | Signed-in screens. Layout = `AppShell` (left sidebar) + `ConfirmProvider`. |
| `src/app/(auth)/*`, `share/[token]`, `privacy-policy`, `terms`, `data-deletion` | Public screens |
| `src/app/api/*` | Route handlers, all wrapped in `route()` (`src/lib/api.ts`) which maps `AppError`/`ZodError`/auth errors to JSON. Public API: `api/v1/*` and `api/mcp` (API keys). |
| `src/lib/posts.ts` | Create/update/cancel/remove posts, approval, queue resolution, network rule checks |
| `src/lib/scheduler/` | `runner.ts` (claims due destinations, publishes, retries via `backoff.ts`), `jobs.ts` (worker job table: publish, analytics, pageInsights, edges, instagram, ads, rss, evergreen, housekeeping, tokens, reports) |
| `src/lib/facebook/` | Graph client (`graph.ts`, budget-aware), publish strategies (`publish.ts`: feed, photos, video, reel, story), insights, metric catalogue (`metrics.ts`), OAuth, permissions |
| `src/lib/networks/` | Other networks: `types.ts` (connector contract, `netJson`, failure kinds), one file per network, `connect.ts` (OAuth/app-password connect + save), `index.ts` (registry, `publishToNetwork`) |
| `src/lib/network-rules.ts` | Per-network limits, client-safe (composer warnings + server refusal) |
| `src/lib/analytics.ts`, `page-analysis*.ts` | Sync and read insights; the analysis model (KPIs, health, cadence, best times, findings) |
| `src/lib/engagement.ts` | Comments, reviews, conversations, external posts, videos (the "edges") |
| `src/lib/reports.ts`, `report-schedules.ts` | Reports, templates, scheduled emails |
| `src/lib/share-links.ts` | Client review/calendar/portal links (token hashed, revocable) |
| `src/lib/api-tokens.ts`, `public-api.ts` | API keys and the operations REST/MCP expose |
| `src/lib/chat.ts` | Slack/Telegram alert channels |
| `src/lib/ai.ts` | Claude (Anthropic SDK): caption, improve, hashtags, week plan |
| `src/lib/page-access.ts` | Per-member Page scope — **use it in every query that lists Pages or posts** |
| `src/lib/settings/` | Runtime settings registry (`definitions.ts`) → Configuration screen |
| `src/components/` | UI. Key: `AppShell`, `Composer`, `PostList`, `TargetPicker`, `PagesSidebar`, `PageMenu`, `Dialog`, `ConfirmProvider`, `FeedPost`, charts in `charts/`, `analysis/` |
| `prisma/schema.prisma`, `prisma/migrations/` | 47 models; migrations are additive |
| `messages/*.json` | All UI text |
| `tests/`, `e2e/` | Vitest and Playwright |
| `scripts/deploy/` | Production deploy/rollback (see RELEASE.md) |
| `scripts/dev/` | Test DB + psql shim |
| `docs/` | Human docs (ARCHITECTURE, DEPLOYMENT, META_APP_SETUP, PROJECT_SCHEMA), `docs/ai/` (this), `docs/inspiration/simplified/` (competitor research + 50 screenshots), `docs/meta-review/` (App Review texts) |

## Conventions

- Server components fetch; client components (`'use client'`) only for
  interaction. Never import `@/lib/prisma` (or anything reaching it) into a client
  component.
- Errors for users: `AppError({ key: 'errors.x', fallback, params, status })`, key
  translated in both catalogues. Helpers in `src/lib/errors.ts`.
- Validation with zod at the route boundary; schemas live next to their lib.
- Every list/query of Pages or posts goes through `targetScope`/`postScope`/
  `assertPagesAllowed`/`assertPageParam`/`assertPostInScope`.
- Times: store UTC; display with `formatInZone(date, workspace.timezone, fmt)`;
  local inputs via `localInputToUtc`.
- Activity log: `logActivity(workspaceId, action, details, userId)` — actions are
  a fixed union in `src/lib/activity.ts`.
- Comments explain *why*, in full sentences, like the surrounding code.
- Commit to `main`, messages in plain English describing the user-visible change,
  ending with the `Co-Authored-By` line the session gives you.

## Everyday commands

```bash
npm run dev                         # web on :3000 (needs .env with DATABASE_URL etc.)
npm run dev:worker                  # scheduler worker
npx tsc --noEmit                    # typecheck
# tests: see TESTING.md ; deploy: see RELEASE.md
```
Adding text: `python3 scripts/dev/add-messages.py new.json` with
`{"en":{"ns":{"key":"…"}},"fr":{"ns":{"key":"…"}}}` — merges into both catalogues.

## Where things stand (2026-10-11)

See [STATUS.md](STATUS.md) for the full session record: what was built, Meta
review state, configuration gaps, accounts, decisions, and open items.
