---
name: profile-selection
description: Make a screen, query, export or API route obey MS Social Pilot's shared profile (Page) selection — single, multiple, group or network filter — so planned, posted and analytics data always match what the user picked. Use for any list, calendar, analytics, report, inbox or export work.
---

# Shared profile selection

Spec: `docs/ai/NEXT_PHASES.md` Phase A. Patterns: `docs/inspiration/simplified/PATTERNS.md §1`.

## Rules
1. **One selection for the whole app.** URL params `group`, `pages` (comma ids),
   `net` (network) are the source of truth; when absent, fall back to the cookie
   `msp_sel_<workspaceId>`; when that is absent, all Pages in the member's scope.
2. **Always clamp server-side** to `auth.pageScope` — read it with
   `loadPageFilter()` / `loadSelection()` in `src/lib/page-filter.ts`, never by
   trusting ids from the client. Unknown or out-of-scope ids are dropped silently.
3. **Every query filters by it**: posts (`targets.some.targetId in ids`),
   insights snapshots, comments, inbox threads, reviews, videos, ads (ad accounts
   linked to those Pages), exports, report defaults.
4. **Links keep it**: build hrefs with the selection query so the sidebar and
   in-page links don't reset it.
5. **Show it**: render the `ProfileScope` bar (or `PagesSidebar` on calendar /
   posts — same state) and say it in headings ("12 posts · 3 profiles").
6. **Never empty**: at least one profile; "Only" shortcut selects one.
7. Analytics with 2+ profiles follows the aggregation rules in
   NEXT_PHASES §B2 (unique reach is not additive; recompute rates; group money
   by currency) — see the `analytics-dashboard` skill.

## Checklist for a screen
- [ ] Server component reads the selection once and passes ids down.
- [ ] Client components receive ids/pages as props (no prisma imports).
- [ ] Empty result explains the filter ("No scheduled posts for these 3 profiles
      — show all profiles").
- [ ] Unit test for clamping; e2e: pick 2 of 3 seeded Pages, navigate across
      Calendar → Posts → Analytics → Dashboard, only those appear; reload keeps it.
- [ ] en + fr strings with ICU plurals for counts.
