# Design v2: simple, channel-first MS Social Pilot

Status: **target design, not built yet.** Written 2026-10-21 at `99c4155`.
Built from the owner's direction in this session:
"the UI is very complex, I need it to be simple and efficient for a human user",
then "suggest a better idea (check Meta, GitHub, Vercel, social scheduling
competitors)", then "make a good complete design architecture … and full
documentation to hand over to the next AI to build, fix and improve".
The owner also chose to put number caveats **behind an ⓘ popover**.

Merging the pull request that adds this folder is the owner's approval of the
v2 direction. Until then, treat v2 as a proposal and change nothing in
production behaviour. The binding product rules in
[../ARCHITECTURE_CONTRACT.md](../ARCHITECTURE_CONTRACT.md) still apply.
Design v2 changes **how** the product is presented. It does not change
services, authorization, data, provider ownership or MCP/API behaviour.

## What v2 changes, in one paragraph

Today there are about 45 customer pages, two left sidebars (336 px of chrome),
filters inside the sidebar, and long caveat paragraphs on every number.
v2 has **one collapsible sidebar** with four work areas: Home, Plan, Inbox
and Results. Below the areas is the **channel list**, which scopes every
page. Each area uses **tabs** instead of separate menu pages. There is
**one Filter button** per page. The composer opens **full screen** with
one action bar. **Numbers come first**, and the caveats sit behind ⓘ.
Phones get a bottom bar with a central Create button.

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
| — | [prototype.html](prototype.html) | Clickable static prototype of the v2 shell, Plan, Create, Results, Inbox, phone |

Supporting evidence:

- [../DESIGN_AUDIT_2026-10-21.md](../DESIGN_AUDIT_2026-10-21.md): the 16 design defects, which v2 batch 0 fixes first.
- Screenshots of today's UI were taken on local synthetic data. Re-create them with
  `rebuild/scripts/preview-screenshots.cjs` (see 06).

## Decision record

| Date | Decision | Source | Supersedes |
|---|---|---|---|
| 2026-10-21 | Simplify the customer UI for human users; v2 target | Owner, this session | — |
| 2026-10-21 | Number caveats behind an ⓘ popover, not inline paragraphs | Owner answer | Inline provenance text on customer cards |
| 2026-10-21 | One collapsible sidebar with areas + channel list; tabs inside areas; Filter button in the page header | Proposed here; approved by merging this PR | DESIGN.md "two left sidebars" (owner request 2026-10-16) and the contract §6 sentence placing filters in the sidebar system |
| 2026-10-21 | New route families `/plan`, `/create`, `/results`; old `/publishing/*`, `/analytics/*`, `/ads/*` redirect | Proposed here | Contract §4 route families (which already say "as needed") |

When this PR merges, the builder must update
[../../DESIGN.md](../../DESIGN.md) and contract §4 and §6 in the first
build batch. Each update quotes this record. See 08, batch 0.

## Non-goals

- No change to services, authorization, tenant scope, confirmations, audit or provider modules.
- No new provider capability. Unsupported operations stay hidden.
- No removal of any capability. Every legacy and current feature keeps a home in the route map (01).
- Root stays private and technical. It gets the same shell, but keeps its operator detail.
