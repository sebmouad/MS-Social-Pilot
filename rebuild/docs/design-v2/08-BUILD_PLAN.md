# 08. Improvement plan (final, owner-approved 2026-10-21)

## Strategy

- **Improve the same app (owner decision).** This is not a rebuild: each step changes the existing code in `rebuild/src` in place (see README "How v2 is delivered"). There is no v1/v2 switch. Each step improves the UI for everyone once its checks pass, and it ships through the normal release (`rebuild/scripts/prod-deploy.sh`). Rollback is that script's swap-back to the previous release. Every batch must therefore leave the whole app usable and coherent.
- **Transitional adapter.** B1 replaces the frame for every page at once. Pages not yet migrated still render their `SidebarDock` content, now shown in a "Page tools" panel opened from a header button: a side `Sheet` on desktop and a bottom sheet on phone. Each area batch removes its pages from the adapter. B9 deletes the adapter and `SidebarDock`.
- **Routes.** An area batch adds its new routes (`/content/*`, `/create`, `/insights/*`, `/settings/*` changes) and, **in the same batch**, adds 308 redirects from the old routes. The redirect table lives in a small middleware generated from manifest declarations, maps query parameters (01 §5) and keeps unknown parameters. A test asserts every old route lands on an existing page.
- **Small, reviewable batches.** One PR per batch, with screenshots (06 §3) and the review checklist (06 §4) filled in.
- **File ownership** is listed per batch, so parallel agents never edit the same files (AGENTS.md). Shared files (`tokens.css`, `components.css`, `components/index.ts`, `src/lib/product.ts`, the middleware) belong to the batch that lists them. Other batches ask before touching them.
- **Never touch in design batches:** service authorization, confirmations, audit, provider modules, migrations. The parity lane (P) changes services only where 07 says so.

## Phone priorities (owner: all four)

Every batch that touches these flows must pass them at 390 px, one-handed, with no horizontal scroll:

1. **Inbox reply.** Open a conversation, reply with a saved reply and resolve it, all within 3 taps of the bottom bar.
2. **Create.** Write, add a photo from the camera roll, choose channels, then schedule or publish. The action bar is always visible.
3. **Check status.** Content › Posts shows status chips in compact rows. Failed posts are listed first on Home under "Needs attention".
4. **Insights numbers.** 4 tiles in a 2×2 grid, the ⓘ opens a bottom sheet, and the main chart can be scrolled sideways inside its card.

## Batches

### B0. Foundations, decisions, default theme

**Owns:**
- `src/styles/tokens.css`, `src/styles/components.css`, `src/styles/responsive.css`
- `src/app/layout.tsx` (font)
- `src/lib/themes.ts`, plus `src/lib/config/shared-config.ts` (only the `theme.default` default → `clean`, with a `CONFIG_SCHEMA_VERSION` bump)
- tests `theme-contrast*.test.ts` and a new `design-tokens-v2.test.ts`
- `DESIGN.md`, `UX-CONTRACT.md`, `docs/DESIGN_COMPONENTS.md`
- `docs/ARCHITECTURE_CONTRACT.md` (§4 and §6 decision lines only)
- `.claude/skills/frontend-design/SKILL.md`, `.claude/skills/ux-copy-house/SKILL.md`

**Work:**
1. Delete the round-4 override layer (02, rule zero).
2. Apply the audit P1/P2 token fixes (02 §1.1) and the area colours (§1.2).
3. Apply the type, size, radius and motion tokens (§2–4), the focus rule (§5) and the chart slot contrast (§6).
4. Load Inter with `next/font`.
5. Make **Clean** the default for new users. Existing users keep their saved theme.
6. Record every README decision in DESIGN.md, UX-CONTRACT.md and contract §4/§6, quoting the decision record.
7. Rewrite the two repo skills, which describe the **legacy** app (`docs/DESIGN.md`, `messages/*.json`, `.card`, `brand-*`), to point at the rebuild and this folder.

**Accept:**
- Contrast tests pass for 8 palettes and system mode.
- New tests pass:
  - area-colour uniqueness
  - fields use `--control-border`
  - no `data-mode="dark"` component rules
  - at most 9 font sizes in shared CSS
- Screenshots in Clean light/dark and Vivid show no regressions.

### B1. Shell improvement (single sidebar, channel scope, header, popovers, phone bar)

**Owns:**
- Existing `src/components/AppShell.tsx` (evolves into the single sidebar, top bar and phone bar), `PageHeader.tsx`, `FilterPanel.tsx`, `Drawer.tsx`, `RouteNotice.tsx`, `MetricCard.tsx`, `DataTable.tsx`
- New only where missing: `src/components/{Popover,InfoTip,ChannelScopeList,BottomBar,SidePanel,ListRow,SplitButton,ActionBar,DateRangePicker}.tsx`
- `Menu.tsx`, `Select.tsx` (move onto Popover), `Tabs.tsx`
- `src/server/PageFrame.tsx`
- `src/server/context.ts` (`actorFromViewer`, `parseChannelScope`)
- `src/lib/product.ts` (areas and tabs from manifests)
- every `src/modules/*/manifest.ts`: data-only edits for `area`, `tab` and bilingual titles
- new `src/modules/shell/` (copy catalog `shell.copy` + config)
- the redirect middleware skeleton
- the "Page tools" adapter

**Work:**
- Evolve the existing components per 03; add the missing ones.
- Build the channel scope per 01 §5: cookie + URL + validation notice.
- Tasks and Agency show only when used (01 §4).
- Sign-in lands on Home.
- Phone bottom bar.

**Accept:**
- Every existing page renders in the improved shell with no lost function: dock content is reachable through Page tools.
- Keyboard walk passes, with focus trap and Escape working.
- The scope chip and the sidebar stay in sync.
- No popover is clipped, including the row menu on the last table row and inside a dialog.
- EN/FR covered.

### B2. Create (full-screen composer)

**Owns:**
- `src/modules/publishing/ui/compose/**`
- `src/modules/publishing/components/PostAttachments*`
- `src/app/create/page.tsx`
- redirect from `/publishing/compose`

**Work:** S7, by refactoring the existing `PostComposer` and `ComposeScreen` (not a new composer). Reuse today's server actions; services do not change. Move destinations and time out of the dock.

**Accept:**
- Draft, schedule, queue and publish-now all work.
- A failure keeps the input.
- Best times appear.
- Phone priority 2 passes.
- EN/FR covered.

### B3. Content

**Owns:**
- `src/modules/publishing/ui/{posts,calendar,queue,approvals,labels,templates,media,collaboration}/**`
- `src/modules/feeds/ui/**`, `src/modules/media/ui/**`
- `src/app/content/**`
- the Content redirect entries

**Work:**
- S2–S6.
- Table + `SidePanel` (remove the Feed and Cards views and their saved-view values; map old `view=` params to the table).
- Compact phone rows.
- Queue slots on the calendar.

**Accept:**
- Every old Publishing route redirects.
- Bulk actions and paging work.
- The `?post=` deep link opens the panel.
- Phone priority 3 passes (at least 8 posts per screen).

### B4. Inbox

**Owns:** `src/modules/inbox/ui/**`, `/inbox/rules`.

**Work:** S8.

**Accept:**
- Three panes on desktop, two pages on phone.
- Shortcuts work.
- The durable deletion flow is unchanged.
- Phone priority 1 passes.

### B5. Insights

**Owns:**
- `src/modules/analytics/ui/**`, `src/modules/ads/ui/**`
- `src/components/charts/**`
- `src/app/insights/**`
- the Insights redirect entries

**Work:**
- S9–S12, with ⓘ for every caveat.
- The chart fixes (02 §6).
- Merge Ads reporting and Compare into Insights.
- Coordinate with P1 (Ads read services).

**Accept:**
- Overview is at most 1,800 px tall with the sample data.
- Ads Accounts is one table.
- The numbers equal REST/MCP for the fixture.
- Phone priority 4 passes.

### B6. Settings

**Owns:** `src/modules/settings/ui/**`, the sharing and integrations UI, the `/settings/*` routes and redirects.

**Work:** S13.

**Accept:**
- Each card saves independently with feedback.
- The disconnect flow is unchanged.
- No internal IDs appear on customer screens.

### B7. Home, Tasks, Agency

**Owns:** `src/modules/{home,tasks,agency}/ui/**`.

**Work:** S1 and S14.

**Accept:**
- "Needs attention" is driven by real counts.
- Cards fail independently.
- Tasks and Agency follow the "only when used" rule.

### P. Parity lane (parallel, from B1)

**Owns:** only the service files named in 07, `src/modules/integrations/server/rest-tools.ts`, `app/api/v1/**`, and their tests.

**Work:** 07 P1–P9. Coordinate P1/P2 with B5 and P3/P4 with B2.

**Accept:** each item's acceptance column in 07.

### B8. Root (last UI batch, owner decision)

**Owns:**
- `src/app/root/**`
- `src/server/root/*.tsx` and `src/server/jobs/*.tsx`, moved into `src/modules/root/ui/`

**Work:** S15 with the same frame and components; keep the technical detail.

**Accept:**
- Root keyboard and phone paths work.
- No customer-facing change.

### B9. Verification and cleanup

**Owns:** the browser matrix scripts and docs; deletion of `SidebarDock`, the Page tools adapter and any dead v1 CSS.

**Work:**
- Full matrix (06 §3): three engines, four themes, light/dark/system, desktop/phone, keyboard and injected failures.
- Fix the findings.
- Update ARCHITECTURE.md, UX-CONTRACT.md, GOAL, DELIVERY_PLAN and AGENT_HANDOFF.

**Accept:**
- Zero open P1/P2 findings.
- No `SidebarDock` imports left.
- Evidence recorded by kind.

## Order and parallelism

```
B0 ─► B1 ─┬─► B2 ─► B3 ─┐
          ├─► B4 ────────┤
          ├─► B5 ────────┼─► B8 (Root) ─► B9
          └─► B6 ─► B7 ──┘
P (parity) runs alongside from B1; coordinate with B2 and B5.
```

Each arrow is a shipped release. Without parallel agents, follow the numeric order.

## Risks

| Risk | Mitigation |
|---|---|
| No switch, so every batch reaches all users | Small batches; screenshots and the browser check on the changed routes before release; `prod-deploy.sh` swap-back as rollback |
| A half-migrated app feels inconsistent | B1 frame first, then the Page tools adapter; area batches in usage order (Create, Content, Inbox, Insights) |
| Users miss the Feed/Cards views | The side preview shows the full post; saved views with `view=feed|cards` open the table with a one-time notice |
| Losing a capability during merges | The route map (01 §6) is the checklist; the redirect test; LEGACY_CAPABILITY_PARITY rows checked per batch |
| Ads numbers differ after the move to services | Fixture-based equality test (07 P1) |
| EN/FR drift | Required copy props; copy-coverage and banned-word tests |
