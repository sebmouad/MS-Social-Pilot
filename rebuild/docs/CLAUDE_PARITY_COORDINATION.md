# Claude parity coordination

Created: 2026-10-17. Coordinator: Claude (Sonnet 5.5). Integrator: lead Codex.
Live status: `/private/tmp/msp-claude-worker/coordinator-status.md` (not versioned).
Target stays [ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md); gaps are
listed in [LEGACY_CAPABILITY_PARITY.md](LEGACY_CAPABILITY_PARITY.md). This file
records worker ownership only; it proves no capability.

## Rules for every worker

- Read AGENTS.md, the contract, ARCHITECTURE.md, the parity inventory, DESIGN.md
  and UX-CONTRACT.md; inspect the legacy source named in the assignment.
- Create **new files only** inside the owned paths below. Never edit reserved
  files (registry.ts, mcp/server.ts, permissions, entitlements, manifests, shell,
  auth, existing docs, other workers' files, root legacy `src/`, migrations,
  Prisma projection, env/credentials). Report needed host wiring instead.
- No git staging/commits/reset/stash/checkout/push. No schema push, no
  production or provider writes, no spending. New schema = proposed migration
  SQL under the worker's doc, not applied. Use parameterized SQL on legacy tables.
- Services own tenant, role, resource scope, state transitions, audit; UI/API/MCP
  are thin. Export typed config tuples and MCP definitions for the lead.
- Focused tests + typecheck diagnostics only (no broad suites). Tests cover
  tenant/role/resource isolation, transitions, failure and audit.
- Final handoff: `/private/tmp/msp-claude-worker/results/<id>.md` with changed
  paths, exports, host wiring, checks, limitations, remaining proof.

## Reserved (all workers)

Lead: lib/config/registry.ts, server/mcp/server.ts, server/permissions/**,
server/entitlements/**, module manifests, shared shell/navigation, sign-in/auth,
existing canonical docs. Codex workers: password recovery, Analytics explorer,
workspace policy, modules/publishing/server/lifecycle.ts. Pending-integration batch:
modules/publishing/{templates*,template-mcp*,labels*,server/templates*,server/labels*},
app/publishing/{templates,labels,compose}/**, app/api/publishing/{templates,labels}/**,
app/inbox/**, modules/inbox/{productivity*,components/**,server/productivity*},
settings workspace policy files.

## Assignments (paths relative to rebuild/src unless `tests/` or `docs/`)

| ID | Wave | Slice | Owned new paths |
| --- | --- | --- | --- |
| W1 | 1 | Publishing collaboration: per-post/bulk label assignment, custom fields, internal notes, version history, queue slots, content mix, recycle | `modules/publishing/collaboration/**`, `app/publishing/collaboration/**`, `app/api/publishing/{assignments,custom-fields,notes,versions,queue-slots,content-mix,recycle}/**`, `tests/publishing-collab*.test.ts`, `docs/PUBLISHING_COLLABORATION.md` |
| W2 | 1 | Client share/review links, calendar/portal links, public bio | `modules/sharing/**`, `app/share/**`, `app/bio/**`, `app/settings/sharing/**`, `app/api/sharing/**`, `tests/sharing-*.test.ts`, `docs/CLIENT_SHARING.md` |
| W3 | 1 | Ads reporting/management gaps (comparison, trends, findings, object directory, status/budget/creative) + Facebook-owned ad operations | `modules/ads/analysis/**`, `modules/ads/directory/**`, `modules/ads/management/**`, `app/ads/compare/**`, `app/ads/objects/**`, `app/api/ads/{compare,directory,management}/**`, `platforms/facebook/ads-ops/**`, `tests/ads-parity-*.test.ts`, `tests/facebook-ads-ops*.test.ts`, `docs/ADS_PARITY.md` |
| W4 | 1 | Private Root plans, privileges, user/workspace lifecycle, errors, backup/diagnostic ops, per-module grouping | `server/root/legacy/**`, `app/root/{plans,privileges,lifecycle,errors,backups}/**`, `app/api/root/{plans,privileges,lifecycle,errors,backups}/**`, `tests/root-legacy-*.test.ts`, `docs/ROOT_LEGACY_OPERATIONS.md` |
| W5 | 2 | Analytics: demographics, pinned metrics, comparisons, report workflows | `modules/analytics/{demographics,pins,comparison,reports}/**`, `app/analytics/{demographics,reports}/**` (new subdirs only), `app/api/analytics/{demographics,pins,comparison,report-workflows}/**`, `tests/analytics-parity-*.test.ts`, `docs/ANALYTICS_PARITY.md` |
| W6a | 2 | Agency/client views and tasks | `modules/agency/**`, `modules/tasks/**`, `app/agency/**`, `app/tasks/**`, `app/api/{agency,tasks}/**`, `tests/agency-*.test.ts`, `tests/tasks-*.test.ts`, `docs/AGENCY_TASKS.md` |
| W6b | 2 | Feeds ingestion, AI assist, media library (video, quotas, imports) | `modules/feeds/**`, `modules/ai/**`, `modules/media/**`, `app/feeds/**`, `app/media/**`, `app/api/{feeds,ai,media-library}/**`, `tests/{feeds,ai,media-library}-*.test.ts`, `docs/FEEDS_AI_MEDIA.md` |
| W7 | 2 | Notifications, webhooks, REST v1 tokens, OAuth clients | `modules/integrations/**`, `app/settings/{notifications,webhooks,api-access}/**`, `app/api/{notifications,webhooks,v1,oauth-clients}/**`, `tests/integrations-*.test.ts`, `docs/INTEGRATIONS.md` |
| W8 | 3 | Facebook-native publishing formats (video, Reel, Story, Group, native scheduling), connection/inbox/analytics remainder. No live writes; respect held canary lock | `platforms/facebook/formats/**`, `platforms/facebook/native-*.ts`, `tests/facebook-formats-*.test.ts`, `docs/FACEBOOK_NATIVE_FORMATS.md` |

W3 and W8 never edit the same file: W3 uses `ads-ops/**`; W8 uses `formats/**`
and `native-*.ts`. Existing Facebook files are read-only for both; propose patches.

Concurrency: four workers at once. Wave 1 first; each finished slot is refilled
from wave 2, then wave 3.

## Status

See live file; final per-worker results are summarized below as they finish.

| ID | State | Result file |
| --- | --- | --- |
| W1 | done (47 mocked tests; unwired) | results/W1.md |
| W2 | done (31 mocked tests; unwired) | results/W2.md |
| W3 | done (69 mocked tests; unwired) | results/W3.md |
| W4 | done (76 mocked tests; unwired) | results/W4.md |
| W5 | running | results/W5.md |
| W6a | running | results/W6a.md |
| W6b | running | results/W6b.md |
| W7 | running | results/W7.md |
| W8 | queued | |
