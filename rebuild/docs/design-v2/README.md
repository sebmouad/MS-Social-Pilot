# Design v2: improvement plan for the current MS Social Pilot app

Status: **final plan approved by the owner on 2026-10-21. B0 (tokens, Clean default), B1 (shell), B2 (Create), B3 (Content), B4 (Inbox) and B5 (Insights) are built in the working tree (2026-10-22, uncommitted); B6 to B9 are not started.** B5 evidence: source, unit and jsdom tests only (typecheck 0 errors; full suite green); no browser run; see [AGENT_HANDOFF.md](../AGENT_HANDOFF.md) "Design v2 B5". B2/B3 evidence: source, unit and jsdom tests only (typecheck 0 errors; full suite 706 files, 11,438 tests passed, 0 failed); no browser run, screenshots or review checklist yet. See [AGENT_HANDOFF.md](../AGENT_HANDOFF.md) "Design v2 B2 and B3". Written at `99c4155`. B1 evidence: source, unit and jsdom tests only; no browser run, screenshots or review checklist yet. See [AGENT_HANDOFF.md](../AGENT_HANDOFF.md) "Design v2 B1".
Built from the owner's direction in this session:
"the UI is very complex, I need it to be simple and efficient for a human user",
then "suggest a better idea (check Meta, GitHub, Vercel, social scheduling
competitors)", then "make a good complete design architecture … and full
documentation to hand over to the next AI to build, fix and improve".
The owner then answered the open design questions in the session. The answers are
in the decision record below, and they make this the final plan.

The binding product rules in
[../ARCHITECTURE_CONTRACT.md](../ARCHITECTURE_CONTRACT.md) still apply.
Design v2 changes **how** the product is presented. It does not change
services, authorization, data, provider ownership or MCP/API behaviour.

## What v2 changes, in one paragraph

Today there are about 45 customer pages, two left sidebars (336 px of chrome),
filters inside the sidebar, and long caveat paragraphs on every number.
v2 has **one collapsible sidebar** with four work areas: Home, Content, Inbox
and Insights (Tasks and Agency appear only when used). Below the areas is the **channel list**, which scopes every
page. Each area uses **tabs** instead of separate menu pages. There is
**one Filter button** per page. The composer opens **full screen** with
one action bar. **Numbers come first**, and the caveats sit behind ⓘ.
Phones get a bottom bar with a central Create button.

## How v2 is delivered: improvements to the same app (owner, 2026-10-21)

v2 is **not a rebuild and not a second app**. It improves the application that runs
in production today. That application's source lives in `rebuild/`; the folder name is
historical, and it is the live app. Rules for every step:

- **Change existing files in place.** `AppShell.tsx` evolves into the new sidebar.
  `PageHeader`, `DataTable`, `Menu`, `Select`, `MetricCard`, `FilterPanel`, `Drawer`
  and `RouteNotice` gain the v2 behaviour. Existing screens are refactored, not
  rewritten from scratch.
- **Add a new component only when nothing similar exists**: `Popover`, `InfoTip`,
  `SidePanel`, `SplitButton`, `ActionBar`, `ListRow`, `BottomBar`, `DateRangePicker`.
- **Keep everything that works:** services, data, authorization, MCP/API, tests,
  Root settings and user preferences.
- **Small improvement PRs.** Each step ships to users through the normal release, keeps
  the app fully usable, and keeps existing tests green (updated only where the UI
  intentionally changed).
- **Delete as you replace.** When a step supersedes old code (for example
  `SidebarDock` or the Feed/Cards views), remove it in the same step or the
  cleanup step. Do not keep two versions alive.

## Final plan at a glance

| Item | Decision |
|---|---|
| Areas | Home · Content · Inbox · Insights. Tasks and Agency appear only when used. Settings sits in the sidebar footer. |
| Navigation | One collapsible sidebar with a channel list (scopes every page). Tabs inside areas. One Filter button per page. |
| Content | Table + side preview (no Feed or Cards). Calendar, Queue, Approvals and Library are tabs. |
| Create | Full-screen composer with a sticky action bar: Save draft · Schedule ▾ (Publish now, Add to queue, Schedule…). |
| Insights | 4 key numbers first; caveats in ⓘ; Ads reporting merged in. |
| Phone | Bottom bar with a central Create button; first-class Inbox replies, Create, post status and Insights numbers. |
| Theme | Clean is the default for new users. Vivid, Meta blue and Warm stay selectable. All fix the audit's contrast defects. |
| Landing | Home after sign-in. |
| Rollout | Improve the current app in place, step by step through the normal release; no rebuild, no parallel version. Rollback is the release swap-back. |
| Order | B0 foundations → B1 frame → B2 Create → B3 Content → B4 Inbox → B5 Insights → B6 Settings → B7 Home/Tasks/Agency → B8 Root → B9 verification; parity lane P runs alongside |

## Read in this order

| # | Document | Use it for |
|---|---|---|
| 1 | [01-PRINCIPLES_AND_IA.md](01-PRINCIPLES_AND_IA.md) | Principles, research basis, areas, route map old → new, channel scope |
| 2 | [02-FOUNDATIONS.md](02-FOUNDATIONS.md) | Tokens: colour fixes, type, spacing, heights, density, radius, motion, charts |
| 3 | [03-COMPONENTS.md](03-COMPONENTS.md) | Shared components to keep, change, add or delete, with full state specs |
| 4 | [04-SCREENS.md](04-SCREENS.md) | Handoff spec for every screen (layout, components, states, phone, a11y) |
| 5 | [05-CONTENT.md](05-CONTENT.md) | Plain-language rules, banned words, ⓘ pattern, EN/FR catalogs |
| 6 | [06-ACCESSIBILITY_QA.md](06-ACCESSIBILITY_QA.md) | WCAG rules, local preview setup, screenshot tool, verification matrix |
| 7 | [07-PARITY.md](07-PARITY.md) | UI vs REST vs MCP findings from the code, with fixes |
| 8 | [08-BUILD_PLAN.md](08-BUILD_PLAN.md) | Ordered batches, files, acceptance criteria, tests, rollback |
| 9 | [HANDOFF_PROMPT.md](HANDOFF_PROMPT.md) | Paste-ready prompt for the next AI |
| — | [prototype.html](prototype.html) | Clickable static prototype of the v2 shell, Content, Create, Insights, Inbox, phone |

Supporting evidence:

- [../DESIGN_AUDIT_2026-10-21.md](../DESIGN_AUDIT_2026-10-21.md): the 16 design defects, which v2 batch 0 fixes first.
- Screenshots of today's UI were taken on local synthetic data. Re-create them with
  `rebuild/scripts/preview-screenshots.cjs` (see 06).

## Decision record

| Date | Decision | Source | Supersedes |
|---|---|---|---|
| 2026-10-21 | Simplify the customer UI for human users; v2 target | Owner | — |
| 2026-10-21 | Number caveats behind an ⓘ popover, not inline paragraphs | Owner | Inline provenance text on customer cards |
| 2026-10-21 | One collapsible sidebar with areas + channel list; tabs inside areas; Filter button in the page header | Owner ("make a good complete design architecture … to build", after reviewing the proposal) | DESIGN.md "two left sidebars" (owner request 2026-10-16); contract §6 sentence placing filters in the sidebar system |
| 2026-10-21 | Area names **Home · Content · Inbox · Insights** (FR: Accueil · Contenu · Messages · Statistiques) | Owner answer | Module names Publishing/Analytics/Ads in navigation |
| 2026-10-21 | Route families `/content`, `/create`, `/insights`; old `/publishing/*`, `/analytics/*`, `/ads/*` redirect (308) | Owner (follows area names) | Contract §4 route families (which already say "as needed") |
| 2026-10-21 | Tasks and Agency appear **only when used** (tasks exist / more than one client workspace); turn on from Settings | Owner answer | Always-visible Tasks and Agency modules |
| 2026-10-21 | Content shows **Table + side preview** only; Feed and Cards views are removed | Owner answer | UX-CONTRACT/DESIGN "Table default with Feed and Cards available" (2026-10-16) |
| 2026-10-21 | **Replace directly**: each batch ships to everyone once it passes its checks; no `ui.shellVersion` switch. Rollback = the release swap-back in `scripts/prod-deploy.sh` | Owner answer | — |
| 2026-10-21 | **Home** opens after sign-in | Owner answer | — |
| 2026-10-21 | Phone must be first-class for **Inbox replies, Create, post status and Insights numbers** | Owner answer | Phone as "check status and short tasks" only |
| 2026-10-21 | **Root** gets the new layout as the last build batch | Owner answer | — |
| 2026-10-21 | Default theme for new users is **Clean** (Root `theme.default`); Vivid, Meta blue and Warm stay selectable | Owner answer | Vivid default |

Batch B0 records these decisions in [../../DESIGN.md](../../DESIGN.md),
[../../UX-CONTRACT.md](../../UX-CONTRACT.md) and contract §4 and §6. Each edit quotes
this table.

## Non-goals

- No change to services, authorization, tenant scope, confirmations, audit or provider modules.
- No new provider capability. Unsupported operations stay hidden.
- No removal of any capability. Every legacy and current feature keeps a home in the route map (01).
- Root stays private and technical. It gets the same frame in the last UI batch (B8) and keeps its operator detail.
