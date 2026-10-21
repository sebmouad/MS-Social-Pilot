# Handoff prompt for the next AI

Paste the block below into the next session. Fill in the batch number.

```text
You are continuing MS Social Pilot design v2 in the repository sebmouad/MS-Social-Pilot.
Work only in rebuild/. Start by reading, in order:

 1. AGENTS.md
 2. rebuild/docs/ARCHITECTURE_CONTRACT.md
 3. rebuild/docs/design-v2/README.md
 4. rebuild/docs/design-v2/01 to 08 (all eight)
 5. rebuild/docs/DESIGN_AUDIT_2026-10-21.md
 6. rebuild/DESIGN.md and rebuild/UX-CONTRACT.md

Open rebuild/docs/design-v2/prototype.html in a browser to see the target.

Task: implement batch B<N> from rebuild/docs/design-v2/08-BUILD_PLAN.md.
Edit only the files that batch owns.

Hard rules:
- Do not change service authorization, confirmations, audit, provider modules or migrations.
- No provider-specific rules in shared UI.
- Tokens only; shared components only.
- Required EN/FR copy through module catalogs. No English defaults.
- Every number caveat goes in an ⓘ InfoTip (owner decision). Partial results show ⚠.
- Keep v1 working behind ui.shellVersion until B10.

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
- Open questions for the owner. Proceed with the proposal if there is no answer.
  1. Area names: Plan / Results, or Publish / Analytics?
  2. Should Tasks and Agency stay visible for every workspace, or only when used?
  3. Keep Feed and Cards views in Plan, or Table only plus the SidePanel preview?
