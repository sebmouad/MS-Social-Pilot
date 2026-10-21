# 08. Build plan

## Strategy

- **Behind a switch.** A new Root key `ui.shellVersion` (`'v1' | 'v2'`, default `'v1'`) lives in `src/lib/config/shared-config.ts` with schema, label and description, and a `CONFIG_SCHEMA_VERSION` bump. `PageFrame` renders `AppShell` (v1) or `AppFrame` (v2). The owner can preview v2 in production and roll back without a deploy. Remove v1 in batch 10.
- **Routes.** New routes (`/plan`, `/create`, `/results`, …) are thin pages that reuse module screens. When `ui.shellVersion = 'v2'`, old routes redirect (308, query mapped) from a small middleware table generated from manifests. Under v1, new routes still work, so v2 can be tested early.
- **Small, reviewable batches.** One PR per batch, with screenshots (06 §3) and the checklist (06 §4).
- **File ownership.** File ownership is listed per batch, so parallel agents never edit the same files (AGENTS.md). Shared files (`components.css`, `tokens.css`, `components/index.ts`) belong to the batch that lists them. Others ask.
- **Never touch:** services' authorization or confirmations, provider modules, migrations, production deploys (separate gates).

## Batches

### B0. Foundations and record (unblocks everything)

**Owns:**
- `src/styles/tokens.css`, `src/styles/components.css`, `src/styles/responsive.css`, `src/app/layout.tsx` (font), `src/lib/themes.ts`
- tests `theme-contrast*.test.ts` + new `design-tokens-v2.test.ts`
- `DESIGN.md`, `docs/ARCHITECTURE_CONTRACT.md` (§4 and §6 decision lines only), `docs/DESIGN_COMPONENTS.md`
- `.claude/skills/frontend-design/SKILL.md`, `.claude/skills/ux-copy-house/SKILL.md`

**Work:**
1. Delete the round-4 override layer and fold its values into the original declarations (02, rule zero).
2. Apply the audit P1/P2 token fixes (02 §1.1), area colours (§1.2), type, size, radius and motion tokens (§2–4), the focus rule (§5) and the chart slot contrast (§6).
3. Load Inter with `next/font`.
4. Record the decisions:
   - DESIGN.md: replace the "two left sidebars" layout section with a v2 summary + link.
   - Contract §6: filters move to the page-header Filter button and the channel scope sits in the sidebar.
   - Contract §4: route families `/plan`, `/create`, `/results` added.
   - Quote the decision record from the README in each edit.
5. Rewrite the two repo skills (`frontend-design`, `ux-copy-house`), which still describe the **legacy** app (`docs/DESIGN.md`, `messages/*.json`, `.card`, `brand-*`), to point at the rebuild and this folder.

**Accept:**
- All contrast tests pass, including system mode.
- New tests pass: area-colour uniqueness, field borders use `--control-border`, no `data-mode="dark"` component rules, ≤9 font sizes in shared CSS.
- Screenshots show no regression.

### B1. Frame v2 (AppFrame, sidebar, scope, header, popovers)

**Owns:**
- New `src/components/{AppFrame,AppSidebar,ChannelScopeList,ScopeSheet,TopBar,BottomBar,Popover,InfoTip,FilterButton,FilterSheet,PageHeader(v2),Notice,Sheet,SidePanel,ListRow,MetricTile,SplitButton,ActionBar,DateRangePicker}.tsx`
- `Menu.tsx`, `Select.tsx` (popover port), `Tabs.tsx`
- `src/server/PageFrame.tsx`
- `src/server/context.ts` (`actorFromViewer`, `parseChannelScope`)
- `src/lib/product.ts` (area/tab from manifests)
- manifests' new `area`/`tab`/bilingual title fields (all `src/modules/*/manifest.ts`, data-only edits)
- new `src/modules/shell/` (copy catalog + config), the `ui.shellVersion` config

**Work:** components per 03, the channel scope per 01 §5 (cookie + URL + validation notice), and the phone bottom bar.

**Accept:**
- With v2 on, every existing page renders inside the new frame (still with old content).
- Keyboard walk, focus trap and Escape work.
- Scope chip and sidebar stay in sync.
- No popover is clipped in a table, dialog or sidebar (test with Posts row menu on the last row).

### B2. Create (full-screen composer)

**Owns:** `src/modules/publishing/ui/compose/**`, `PostAttachments`, new route `src/app/create/page.tsx`.

**Work:** S7. Reuse today's server actions, so no service changes. Move destinations and time out of `SidebarDock`.

**Accept:**
- Draft, schedule, queue and publish-now paths work.
- Failure keeps input.
- Best times are shown.
- Phone Edit/Preview tabs work.
- EN/FR.

### B3. Plan

**Owns:** `src/modules/publishing/ui/{posts,calendar,queue,approvals,labels,templates,media,collaboration}/**`, feeds UI, new `src/app/plan/**` routes, the redirect table entries.

**Work:** S2–S6, `SidePanel` post detail, compact phone rows, queue slots on the calendar.

**Accept:**
- Every old Publishing route redirects.
- Bulk actions and paging work.
- `?post=` panel deep link works.
- 8 posts fit on a 390 px screen.

### B4. Inbox

**Owns:** `src/modules/inbox/ui/**`, the `/inbox/rules` route.

**Work:** S8. Remove the always-on shortcut legend, quick filters as chips, the details pane.

**Accept:**
- Three-pane layout, two-page on phone.
- Shortcuts work.
- Durable deletion flow unchanged.

### B5. Results

**Owns:** `src/modules/analytics/ui/**`, `src/modules/ads/ui/**`, `src/components/charts/**`, new `src/app/results/**`.

**Work:**
- S9–S12; ⓘ for all caveats; chart fixes (02 §6).
- Ads screens move to read services (07 P1).
- Merge Ads reporting and Compare.

**Accept:**
- Results Overview fits in 2 desktop screens (≤1,800 px tall with sample data).
- Ads Accounts is one table.
- Same numbers as REST/MCP for the fixture.

### B6. Settings

**Owns:** `src/modules/settings/ui/**`, sharing/integrations UI, `/settings/*` routes.

**Work:** S13. Workspace cards with a time-zone `Select`, a Channels card view, merged tabs.

**Accept:**
- Each card saves independently with feedback.
- Disconnect flow unchanged.
- No internal IDs on customer screens.

### B7. Home, Tasks, Agency

**Owns:** `src/modules/{home,tasks,agency}/ui/**`.

**Work:** S1 and S14.

**Accept:**
- Home "Needs attention" is driven by real counts.
- Cards fail independently.

### B8. Root alignment

**Owns:** `src/app/root/**`, `src/server/root/*.tsx` → move into `src/modules/root/ui/` (architecture debt).

**Work:** S15 with the same frame.

**Accept:**
- Root keyboard and phone paths work.
- Nothing customer-facing changes.

### B9. Parity lane (can run in parallel from B1)

**Owns:** `src/modules/*/server/**` (only the files named in 07), `src/modules/integrations/server/rest-tools.ts`, the `app/api/v1/**` routes, and their tests.

**Work:** 07 P1–P9. Run it in parallel, but coordinate P1/P2 with B5 (Ads UI) and P3/P4 with B2.

**Accept:** each item's acceptance column.

### B10. Verification and switch-over

**Owns:** browser matrix scripts and docs; the default of `ui.shellVersion`.

**Work:**
- Run the full matrix (06 §3) in three engines, four themes, light/dark/system, desktop/phone, keyboard and failures.
- Fix the findings.
- Then set the default to `v2`, keep v1 for one release, and remove it after.

**Accept:**
- Zero open P1/P2 findings.
- ARCHITECTURE.md, UX-CONTRACT.md, GOAL, DELIVERY_PLAN and AGENT_HANDOFF are updated.

## Order and parallelism

```
B0 ─► B1 ─┬─► B2 ─► B3 ─┐
          ├─► B4 ────────┼─► B10
          ├─► B5 ────────┤
          ├─► B6 ─► B7 ──┤
          └─► B8 ────────┘
B9 (parity) runs alongside from B1; coordinate with B2/B5.
```

## Risks

| Risk | Mitigation |
|---|---|
| Big-bang regressions | Switch `ui.shellVersion`; per-batch screenshots; old routes keep working until B10 |
| Copy drift between EN/FR | Required copy props; extended copy-coverage and banned-word tests |
| Losing a capability during merges | Route map 01 §6 is the checklist; a test asserts every old route redirects to an existing page |
| Contract conflict | B0 records the decisions before any UI change ships |
| Ads numbers differ after moving to services | Fixture-based equality test (07 P1) |
