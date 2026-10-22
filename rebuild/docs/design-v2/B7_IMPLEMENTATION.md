# Design v2 B7 — Home, Tasks and Agency (2026-10-22)

> Follow-up (lane 56, 2026-10-22, uncommitted): outside-owned leftovers 1–4
> are implemented (see "Design v2 B8" in `../AGENT_HANDOFF.md`). Leftover 5 was
> already fixed on `main` (`b2ac77b2`); leftover 6 is unchanged.

Status: **partial source implementation, uncommitted; not release-ready**. This
lane owns the three modules’ UI, related tests and docs. No services, REST/MCP
handlers, authorization, audit, migrations, provider modules, configuration
registration or schema version changed. No server, deployment, push or production
action was run. The complete S1/S14 acceptance criteria remain open below.

## Visible changes and design rules applied

| Screen | Visible change | Applied skill rules |
| --- | --- | --- |
| Home | Personal greeting rather than workspace greeting; compact date range with period in ⓘ; real nonzero Inbox count links to its work; three available KPIs; Coming up ListRows open each post, with calendar navigation; Inbox and Best times occupy the right column; first-run replaces the dashboard; failed cards offer refresh. Number caveats, schedule ownership and timezone move to disclosures; partial counts show ⚠. | taste-skill: answer the next-action question before detail, quiet panels, real counts and thumbnails, no decorative chart wall. web-design-guidelines: shared names, semantic headings, touch targets, tokens and 2px focus. composition-patterns: existing Card/Body/Tile composition and shared ListRow/InfoTip. react-best-practices: keep the page on the server, a small refresh client component, no new service reads. |
| Tasks | Board/List underline tabs replace Page tools; one header Filter opens a popover/phone sheet; task comments and linked post open in the shared SidePanel. Existing checklist creation remains available. Controls use control-border and focus tokens. | taste-skill: work-first board, meaningful status columns and real assignee avatars. web-design-guidelines: shared tabs/overlay, Escape and focus return, labelled filter fields. composition-patterns: FilterButton as a header slot, existing detail content composed inside SidePanel. react-best-practices: stable close callback, stale comment-response guard, request deduplication and disabled competing controls while a write is pending. |
| Agency overview | All workspaces table remains primary; redundant workspace comparison chart and misleading table-order sparklines removed; export is in the header; quick switch is reachable without Page tools; caveats use metric-specific ⓘ/⚠. | taste-skill: table alignment, honest withheld values, no pseudo-time-series or competing primary actions. web-design-guidelines: responsive shared table, named disclosures, token-based borders/focus. composition-patterns: actions/filter slots on AgencyHeading, reuse WorkspaceAction confirmations. react-best-practices: preserve server reads and small existing client controls. |
| Agency Clients | One header Filter replaces Page tools; Clients has its own heading; accounts/invitations and confirmed team-navigation actions remain. | Same four skills: shared header slots/FilterButton and table states, accessible names/focus, Root EN/FR catalog, server-owned reads with bounded client search state. |

All copy uses existing Root catalogs. The existing `agency.customerCopy` identity
`Client workspaces` now defaults to **All workspaces / Tous les espaces**; saved
operator overrides still win. New Root keys: **none**. CONFIG_SCHEMA_VERSION is
unchanged. Existing `home.lookbackDays`, `home.upcomingLimit` and the service-returned
Task limits remain authoritative. Two fixed UI-only search maxlength values
were removed; server validation still decides valid input.

## Verification

- `npx tsc --noEmit -p .`: **PASS, exit 0, zero errors**.
- Focused 16-file run: **223 passed, 3 optional fixture-export tests skipped**.
  Includes all changed test files, new `tasks-v2-b7`, Home/Tasks/Agency services,
  Tasks/Agency HTTP and Agency MCP, copy coverage, parity guard and config validation.
- Final full suite, only diagnostic transport excluded, cache disabled:
  **718 files passed, 1 failed, 49 skipped; 11,609 tests passed, 5 failed,
  2,556 skipped**. All five failures were `facebook-native-http.test.ts`
  sandbox `listen EPERM ::1`, not B7 assertions. The full suite is **not green**.
- `npm run build`: **failed**. Google Fonts DNS is blocked
  (`ENOTFOUND fonts.googleapis.com`). Independently, the existing client import
  chain `sharing/ui/links/LinksManager.tsx` → `settings/ui/_components.tsx` →
  `settings/ui/copy-server.ts` reaches `next/headers` through configuration/platform
  services (Ads, Analytics, Instagram and LinkedIn). Those files are outside this
  lane’s ownership. This is not a green build.
- Optional synthetic static fixtures generated from real components: Home,
  Tasks and Agency, via `B7_FIXTURE_DIR=/tmp/b7-fixtures` with the three fixture
  test files. No customer database or server used. Playwright attempted a file-only
  Chrome launch; the sandbox terminated Chrome (`SIGABRT`, cleanup `kill EPERM`).
  **No screenshot, browser layout/keyboard/theme/390px clearance is claimed.**
  The static HTML exports are preparation only, not browser evidence.
- `git diff --check`: **PASS**.
- No live provider, real authenticated MCP client, database or production proof.

## Required outside-owned edits / unfinished acceptance criteria

1. **Home service and copy owners:** extend
   `src/modules/home/server/overview.ts` and its shared-service dependencies to
   return authorized failed/partially-failed post, approval and connection-health
   attention counts, link-click current/previous totals, an honest audience delta,
   and recent Inbox rows. Keep each read inside its own settled section; initial
   snapshot/provider lookup currently occurs before section isolation and can
   still reject the full overview. Carry the shared channel selection into the
   service and UI/REST/MCP together rather than filtering figures in the UI.
   Add the corresponding Root EN/FR labels in `home/copy.ts`: Needs attention,
   failure/approval/reconnect row templates, Link clicks, Open calendar and Retry.
   The current strip deliberately only shows the real waiting-conversation count
   and reuses `continueTitle` (Continue your work); it is **not** the full required
   Needs attention strip. Greeting remains the configured Welcome back rather
   than inventing a time-of-day label. Period remains Root-controlled and fixed;
   no Home date filter is introduced without a service contract.
2. **Agency service owner:** extend `src/modules/agency/agency.ts` and
   `server/agency.ts` with authorized Inbox waiting counts and coverage. Project
   these through the same UI/REST/MCP overview/export service; never label open
   Tasks as waiting conversations. The existing table retains its legitimate
   task/team/client columns until that contract exists.
3. **Shell/Settings owners:** existing B1 PageFrame still gates Tasks by
   `workspaceUsesTasks` and Agency by `viewer.workspaces.length > 1`. No B7 UI
   overrides these rules. Settings activation for an unused optional area is
   still absent; Agency currently counts memberships rather than specifically
   client workspaces. Resolve these centrally, with shared-service parity for
   any persisted activation. Global `channel` query values are still rejected
   by the existing Tasks/Agency strict route query parsers; clarify/apply scope
   centrally with those services, not by silently accepting an ignored filter.
4. **Tasks domain owner:** S14’s per-task checklist has no per-task checklist
   model/service. The current Add checklist creates several independent tasks;
   B7 preserves that working operation. Add checklist-item state through a shared
   confirmed/audited service, with UI/REST/MCP and Root configuration, before
   presenting it as a checklist inside one task.
5. **Settings/Sharing owners:** split server-only SectionTabs/copy loading out
   of `settings/ui/_components.tsx` or supply tabs/copy from server parents.
   Client `LinksManager.tsx` must import a browser-safe component entry point.
   Do not fix this by weakening `next/headers` checks or removing authorization.
6. **Integration environment:** rerun the unchanged socket tests where loopback
   is allowed, the build with fonts available and the boundary fixed, and the
   real browser screenshot/interaction matrix. B7 cannot be declared complete
   from this lane’s source/jsdom evidence.

## Files changed

UI:
- `src/modules/home/ui/{HomeScreen.tsx,HomeRetry.tsx,home.module.css}`
- `src/modules/tasks/ui/{TasksScreen.tsx,TaskFilters.tsx,TaskBoard.tsx,tasks.module.css}`
- `src/modules/agency/ui/{AgencyChrome.tsx,AgencyExport.tsx,AgencyFilters.tsx,AgencyScreen.tsx,WorkspaceQuickSwitch.tsx,agency.module.css,copy.ts}`
- `src/modules/agency/ui/clients/ClientsScreen.tsx`

Tests:
- `tests/{home-inventory,agency-ui,agency-shared-screen,tasks76-ui,ads-home-root-polish,tasks-v2-b7}.test.ts`
- `tests/b7-visual-fixture.ts` (optional synthetic static-render helper)

Docs:
- `docs/design-v2/{README.md,08-BUILD_PLAN.md,B7_IMPLEMENTATION.md}`
- `docs/{ARCHITECTURE.md,GOAL.md,DELIVERY_PLAN.md,AGENT_HANDOFF.md,MCP_PARITY.md}`
- `UX-CONTRACT.md`
