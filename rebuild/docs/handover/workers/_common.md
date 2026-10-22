You are a worker on the MS Social Pilot rebuild. Your git worktree is the current directory; the app is in `rebuild/`.

MANDATORY before coding: read `rebuild/docs/ARCHITECTURE_CONTRACT.md` (the binding target), `rebuild/docs/ARCHITECTURE.md`, and for UI work `rebuild/DESIGN.md` and `rebuild/UX-CONTRACT.md`.

Hard rules from the owner:
1. UI, REST API and MCP must expose the SAME capabilities through the SAME shared service (thin entry points; auth, tenant scope, confirmations and audit live in the service).
2. Everything modular: product logic inside `src/modules/<module>/` (manifest.ts, config.ts, mcp.ts, server/, ui/); Facebook-specific code only inside `src/platforms/facebook/`. Shared code never branches on a provider.
3. NOTHING hardcoded: every operational value (limits, timeouts, URLs, labels, options, batch sizes, thresholds) is a typed Root setting declared in the owning module's `config.ts` (or `src/lib/config/shared-config.ts` for shared infra) and read with `runtimeConfig`. Do NOT edit `CONFIG_SCHEMA_VERSION` in `src/lib/config/registry.ts` — list new keys in your final report and the integrator bumps it.
4. Customer copy in English and French. No operator jargon in customer screens.
5. Never touch files outside your OWNED paths (below). If you need a change elsewhere, describe it exactly in your final report instead.

Verification (run from `rebuild/`): `npx tsc --noEmit -p .` must report 0 errors; run the targeted vitest files you touched plus new tests you add (`npx vitest run tests/<file>`). Do not run servers, deploy, push, or touch production. Do not commit if you cannot; leave changes in the working tree.

Final report (last message): what you changed (file list), new Root keys, tests run with results, gaps you found but did not fix, and any edits needed outside your owned paths.

DESIGN QUALITY (owner requirement, mandatory for any UI change):
- Before UI work, read and apply these skills (Claude: use the Skill tool; Codex: read the SKILL.md files): taste-skill, web-design-guidelines, composition-patterns, react-best-practices. Paths: ~/.claude/skills/<name>/SKILL.md.
- The bar is a rich, polished, modern product UI (clear hierarchy, icons, module colors, thumbnails, charts, generous spacing, consistent components), simple to use. "Tests pass" is not enough.
- In your final report, list for each changed screen which skill rules you applied and what visual change a user will see.

FULL CHECKLIST (owner requirement for every lane, not only UI):
- Contract: follow rebuild/docs/ARCHITECTURE_CONTRACT.md, rebuild/docs/LEGACY_CAPABILITY_PARITY.md and rebuild/docs/CONTRACT_AUDIT_2026-10-21.md (do not reintroduce a listed violation).
- MCP + API parity: every new or changed capability must ship as UI + REST route + MCP tool/resource calling the same service; writes need exact confirmations and audit; add the mapping row to rebuild/docs/MCP_PARITY.md and run `npx vitest run tests/parity-guard.test.ts`.
- Root config: register every new key with an `entry({...})` in the owning config list that is actually spread into the registry; run `npx vitest run tests/config-validation.test.ts`.
- Migrations: put new SQL migrations in the repository-root `prisma/migrations/<timestamp>_<name>/` (NOT rebuild/prisma/migrations); add a row for every new table in `rebuild/src/server/data-control/README.md`.
- Security: never remove an ownership/tenant/permission check; add tests for owner/member/viewer and cross-workspace denial.
- Tests: update mocks for any new dependency you import (prisma.$queryRaw, runtimeConfigBatch, new modules) so existing tests keep passing; before finishing run `npx vitest run --exclude "**/facebook-diagnostic-transport.test.ts"` (whole suite) and report the result.
- Design: for any visible change apply taste-skill, web-design-guidelines, composition-patterns, react-best-practices (see DESIGN QUALITY above).
- Facebook Groups are DROPPED (owner decision 2026-10-22; Meta removed the Groups API). Never add Group discovery, publishing, settings or config.
