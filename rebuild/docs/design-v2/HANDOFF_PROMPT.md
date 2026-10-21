# Handoff prompt for the next AI

Paste the block below into the next session. Fill in the batch number.

```text
You are continuing MS Social Pilot design v2 in the repository sebmouad/MS-Social-Pilot.
Work only in rebuild/ (the folder name is historical: it is the live production app).
Start by reading, in order:

 1. AGENTS.md
 2. rebuild/docs/ARCHITECTURE_CONTRACT.md
 3. rebuild/docs/design-v2/README.md
 4. rebuild/docs/design-v2/01 to 08 (all eight)
 5. rebuild/docs/DESIGN_AUDIT_2026-10-21.md
 6. rebuild/DESIGN.md and rebuild/UX-CONTRACT.md

Open rebuild/docs/design-v2/prototype.html in a browser to see the target.

Task: apply improvement step B<N> from rebuild/docs/design-v2/08-BUILD_PLAN.md
to the existing app. This is NOT a rebuild: change existing files and components
in place, refactor existing screens, add a new component only where nothing
similar exists, and delete code you supersede.
Edit only the files that batch owns.

Hard rules:
- Do not change service authorization, confirmations, audit, provider modules or migrations.
- No provider-specific rules in shared UI.
- Tokens only; shared components only.
- Required EN/FR copy through module catalogs. No English defaults.
- Every number caveat goes in an ⓘ InfoTip (owner decision). Partial results show ⚠.
- There is no v1/v2 switch: each batch replaces the old UI for everyone, so every batch must leave the whole app usable (use the Page tools adapter from B1 for pages not yet migrated).
- Clean is the default theme: check Clean light/dark first.

Verify before committing:
- From rebuild/: npx tsc --noEmit -p .
- Targeted vitest files, then the full suite.
- npm run build.
- Local synthetic preview and screenshots (06-ACCESSIBILITY_QA.md §2),
  desktop 1440 and phone 390, in two themes.
- Fill in the design review checklist (06 §4).

Report evidence by kind: source, unit, browser on synthetic data, live provider,
production. Never claim completion from tests alone.

Commit and push to the branch you were given, then open a draft PR with the
screenshots and the checklist. Update rebuild/docs/AGENT_HANDOFF.md and the
"Status" line in design-v2/README.md with what changed and what remains.

Useful skills:
- web-design-guidelines (review UI code)
- vercel-react-best-practices
- vercel-composition-patterns
- dataviz (charts)
- design:accessibility-review
- design:design-critique (on screenshots)
- design:ux-copy
- playwright-expert (browser tests)
- run-tests
The repo skills frontend-design and ux-copy-house describe the legacy app until
B0 rewrites them, so do not follow their legacy file paths.

Tools in the repo:
- scripts/preview-screenshots.cjs (screenshots)
- scripts/parity-inventory.mjs (UI/API/MCP reachability)
- scripts/seed-preview.ts (synthetic data)
- the browser matrix scripts described in docs/BROWSER_MATRIX_2026-10-21.md
```

## State at handoff (2026-10-21)

- Branch `claude/upbeat-mendel-4ej064`, PR [sebmouad/MS-Social-Pilot#3](https://github.com/sebmouad/MS-Social-Pilot/pull/3). It contains the design audit and this design-v2 package.
- Nothing in v2 is built yet. Merging the PR = owner approval of the direction (README decision record).
- **Start with B0.** Its token fixes are small and close the audit's P1 accessibility defects, even before any layout work.
- The owner answered every open question on 2026-10-21. See the README decision record:
  - areas Home · Content · Inbox · Insights
  - Tasks and Agency only when used
  - Table + side preview, with no Feed or Cards views
  - replace directly, with no switch
  - Home first after sign-in
  - phone first-class for Inbox replies, Create, post status and Insights numbers
  - Root as the last UI batch
  - Clean as the default theme
- The order is B0 → B1 → B2 Create → B3 Content → B4 Inbox → B5 Insights → B6 Settings → B7 Home/Tasks/Agency → B8 Root → B9 verification, with the parity lane P alongside from B1.
