# Operator monitoring lane — 2026-10-22

## Delivered behavior

- Private Root Operations now shows open incidents, bounded delivery outcomes and
  observed uptime minutes. Its confirmed action, REST `/api/root/monitoring`
  and installation MCP `get_root_monitoring` / `evaluate_root_monitoring`
  (plus `msp://root/monitoring`) call one shared service.
- Active installation-owner authorization is enforced in the service and checked
  again under transaction locks for writes. Exact confirmation is
  `EVALUATE ROOT MONITORING`; successful state changes record Root audit.
- `operatorMonitoring` evaluates publish failures, disconnected/expiring accounts,
  backup freshness/failure, disk usage and rebuild worker freshness. Only rebuild
  worker heartbeats count; future heartbeats are rejected. Unsupported disk
  measurements remain unknown and cannot resolve an incident.
- Worker, independent web observer and manual evaluation use the same leased
  runner and durable run history. Web observers select only monitoring, never
  publishing or a worker heartbeat. Root watchdog enablement is rechecked each
  tick; global job enablement and the monitoring cron also apply.
- Successful application health probes and fresh worker heartbeats claim unique
  UTC minute/component observations before incrementing `uptime_days`. The UI
  explicitly describes sampled observations rather than continuous availability.
- Incident transitions enqueue email atomically. Delivery claims commit before
  transport; expired/ambiguous sends become uncertain and are never automatically
  replayed. Bounded Root delivery history shows pending/sending/sent/failed/
  unavailable/uncertain outcomes. Email uses the active installation owner's
  current locale and the existing configured shared mail service.
- Worker job failures, partial-failure summaries, runner infrastructure errors,
  tick errors and unexpected startup exits call the existing scrubbed recorder.
- Production release local/public readiness and rebuild rollback readiness use
  `/api/health`; the separate sign-in origin check and isolated legacy recovery
  probe remain intact. Neither script was executed by this lane.

## New Root keys

`root.monitoringPolicy`, `root.monitoring.schedule`,
`root.monitoring.watchdogEnabled`, `root.monitoringMailCopy`,
`root.monitoringCopy`. Registered through module-owned entries spread into the
installed config aggregator. `CONFIG_SCHEMA_VERSION` is unchanged.

## Changed screen and design rules

Root Operations (`/root/operations`) gains monitoring, delivery and availability
sections using the existing themed table system. Taste skill: quiet hierarchy,
real evidence and right-aligned tabular counts. Web design guidelines: semantic
headings, captions, scoped headers, status/alert feedback and the shared accessible
confirmation dialog. Composition patterns: server evidence section plus one
explicit client action, with shared `useConfirm`. React best practices: server
loading of data/copy, type-only browser imports, minimal client state and refresh
only after a validated receipt. All added copy is Root-managed English/French.
SSR/DOM checks cover these changes; no browser was run.

## Verification

- `npx tsc --noEmit -p .`: passed, zero errors.
- `npm run typecheck`: passed, zero errors.
- Focused Vitest run (`--no-cache`): 113/113 tests, 12/12 files passed:
  `operator-monitoring`, `operator-health-probes`, `jobs-worker`,
  `worker-shutdown`, `root-monitoring-surfaces`, `root-monitoring-watchdog`,
  `root-monitoring-ui`, `parity-guard`, `config-validation`,
  `mcp-installation-context`, `raw-sql-void-guard`, `ui-copy-coverage`.
- `bash -n` both changed release/recovery scripts: passed.
- `git diff --check`: passed.
- Final full-suite command: `npx vitest run --no-cache --exclude
  "**/facebook-diagnostic-transport.test.ts"`. **Not green**: 658 files passed,
  one failed, 49 skipped; 10,174 tests passed, five failed, 2,159 skipped.
  All five failures are in `facebook-native-http.test.ts`, where sandbox
  loopback binding fails with `listen EPERM: operation not permitted ::1`.
  No lane assertion failures remain. A socket-capable environment must rerun
  this required suite before claiming a full pass.

## Gaps and integration

Telegram delivery, provider API-usage alerts through a neutral health hook and
the legacy standalone test-alert capability remain separate parity gaps. This
lane does not claim complete legacy alert parity or production readiness.

Migration `prisma/migrations/20261022180000_rebuild_uptime_samples/migration.sql`
adds `rebuild_uptime_samples` and `rebuild_monitoring_deliveries`; both have data
control ownership rows. Apply/rehearse it before enabling monitoring on an
installation. No database migration, browser, real SMTP/provider verification,
release script, deployment, commit or push was performed. No edits outside the
authorized paths are required; integrator owns the schema-version bump and
migration/release verification. Pre-existing patch files/dependency symlinks
were left untouched.

## File list

- `prisma/migrations/20261022180000_rebuild_uptime_samples/migration.sql`
- `rebuild/docs/AGENT_HANDOFF.md`
- `rebuild/docs/ARCHITECTURE.md`
- `rebuild/docs/DELIVERY_PLAN.md`
- `rebuild/docs/GOAL.md`
- `rebuild/docs/LEGACY_SWEEP_2026-10-21.md`
- `rebuild/docs/MCP_PARITY.md`
- `rebuild/scripts/prod-deploy.sh`
- `rebuild/scripts/prod-rollback-drill.sh`
- `rebuild/scripts/worker.ts`
- `rebuild/src/app/api/root/monitoring/route.ts`
- `rebuild/src/app/root/operations/page.tsx`
- `rebuild/src/instrumentation.ts`
- `rebuild/src/modules/installed-config.ts`
- `rebuild/src/modules/root/config.ts`
- `rebuild/src/modules/root/jobs.ts`
- `rebuild/src/modules/root/mcp.ts`
- `rebuild/src/modules/root/monitoring-config.ts`
- `rebuild/src/modules/root/server/operator-monitoring.ts`
- `rebuild/src/modules/root/server/watchdog.ts`
- `rebuild/src/modules/root/ui/MonitoringAction.tsx`
- `rebuild/src/modules/root/ui/RootMonitoring.tsx`
- `rebuild/src/server/data-control/README.md`
- `rebuild/src/server/jobs/run-loop.ts`
- `rebuild/src/server/jobs/runtime.ts`
- `rebuild/src/server/jobs/worker.ts`
- `rebuild/src/server/mcp/root-tools.ts`
- `rebuild/src/server/root/operations.ts`
- `rebuild/tests/jobs-worker.test.ts`
- `rebuild/tests/mcp-installation-context.test.ts`
- `rebuild/tests/operator-health-probes.test.ts`
- `rebuild/tests/operator-monitoring.test.ts`
- `rebuild/tests/parity-guard.test.ts`
- `rebuild/tests/root-monitoring-surfaces.test.ts`
- `rebuild/tests/root-monitoring-ui.test.ts`
- `rebuild/tests/root-monitoring-watchdog.test.ts`
- `rebuild/tests/worker-shutdown.test.ts`
- `rebuild/docs/OPERATOR_MONITORING_2026-10-22.md` (this report)
