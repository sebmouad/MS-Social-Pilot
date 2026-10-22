# Writing agents and background Posts CSV — lane handoff

Patch `agents-install-v2.patch` is applied. Installed source is not release or
legacy capability completion. No database migration application, browser,
real worker/MCP/provider or production verification was performed.

## Installed source

- Agents manifest, Root policy/copy, MCP declarations, shared service, thin
  `/agents` and `/api/agents` entry points, editing/removal confirmations,
  metered post/reply suggestions and content-free paged history.
- Publishing private background CSV jobs, independent status/read MCP tool,
  REST create/status/download route, sidebar progress UI, worker registration,
  expiry cleanup, bounded retries, lease settlement, attempt history and audit.
- Baseline sources `20261101100000_rebuild_writing_agents` and
  `20261101100100_rebuild_post_exports` (squashed into `20261103000000_baseline`); data-control README ownership rows.
  Schema source files remain references; no runtime DDL.

## Root keys

`agents.policy`, `agents.copy`, `publishing.asyncExportPolicy`,
`publishing.asyncExportCopy`, `publishing.asyncExportSchedule`, plus generated
`entitlements.modules.agents` and `entitlements.features.agents/library`.
The integrator must bump CONFIG_SCHEMA_VERSION; this lane did not change it.

## Required integration outside owned paths

`src/server/permissions/index.ts` must include `agents` in PermissionModule and
MODULES, add `agents: null` to MODULE_ROOT_SWITCH and `'agents/library': null`
to FEATURE_MODULE_SWITCH. The missing feature entry currently causes TS2741;
the absent module list entry denies the owner `/content/agents` screen (moved from `/agents`, which redirects). This lane asked
for a scope exception but did not edit the file without authorization. Decide
explicitly whether editor/contributor writing permissions should include Agents;
the current shared role policy permits reads but denies their writes.

The data-control owner must cover all four tables in portability, retained-account
erasure and purge transactions, including deletion races; README rows alone do
not establish coverage. Architecture/goal/plan/handoff owners should record this
batch and its unresolved gates. Shared branding/localized navigation owners must
supply Agents identity/navigation integration where required.

## Remaining product and evidence gaps

Legacy weekly autonomous scheduling, timezone-day claims and persisted draft
creation remain unimplemented; the screen offers reviewed suggestions only.
CSV artifacts remain bounded PostgreSQL content, not unlimited streamed exports.
Migrations need real PostgreSQL application/constraint/cascade verification.
Browser/theme/viewport/focus checks and real provider/MCP execution remain open.
The export label loader returns no visible section if loading fails before any
catalog arrives; supply server-serialized copy in a later UI integration batch.

## Applied UI skills

Agents screen: taste-skill app hierarchy and responsive two-column work area;
web-design-guidelines labelled native controls, shared focus styles, confirmed
writes, announced feedback and retained input; composition-patterns injected
service action and explicit sections; react-best-practices parallel server
loads, type-only service imports and transition pending state. Users see saved
briefs/edit/delete actions, a separate suggestion/review area and history.

Posts sidebar: taste-skill retains contextual sidebar placement and shared themed
buttons; web-design-guidelines provides explicit consent, labelled checkbox,
progress announcements and download link semantics; composition-patterns keeps
policy/service ownership outside the view; react-best-practices guards duplicate
requests synchronously and suppresses late results after unmount. Users see
Prepare CSV, Check progress, a ready-only download and attempt history.
No visual browser evidence is claimed: running servers was forbidden.

## Verification

Focused final run: 13 files, 249 tests passed, including configuration validation,
parity guard, MCP authentication/security, French catalog/UI copy coverage,
service authorization, migrations and asynchronous CSV UI/worker behavior.
Vitest uses --no-cache because node_modules points outside writable roots.
Final full suite: 640 files passed, 2 failed, 49 skipped; 9,877 tests passed,
7 failed, 2,095 skipped (11,979 total). Five failures are sandbox `listen EPERM`
in facebook-native-http; two are Agents owner page smoke checks denied by the
missing shared permissions module registration. Final TypeScript: one TS2741 in
`src/server/permissions/index.ts:30` (missing agents/library switch entry).
The known external permissions error and loopback socket sandbox restriction
prevent a clean completion claim. `git diff --check` passed.

Additional parity review gap: queued export creation currently uses the shared
Posts read authorization, while its MCP declaration classifies creation as a
write. Align that policy across UI/REST/MCP before enabling; no access checks
were removed in this lane.
