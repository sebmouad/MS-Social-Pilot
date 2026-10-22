# Active delivery goal

Updated 2026-10-21 against source HEAD `99c41554`, registry schema **123**.
**Status: active; incomplete.** The owner recorded production cutover on
2026-10-20; current deployed SHA/schema were not re-observed by this lane.

Deliver the full modular, platform-neutral replacement in `rebuild/` under
[ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md): preserve useful legacy
capabilities, one themed English/French experience, identical UI/REST/MCP
capabilities through authorized shared services, typed Root configuration,
complete data controls and verified provider/recovery outcomes. Deployment,
source existence and passing tests do not establish full completion.

[ARCHITECTURE.md](ARCHITECTURE.md#current-head-reconciliation--2026-10-21) records
the current source delta: Ads inventory without delivery, contract fixes,
Analytics/Home number corrections, smoke coverage and merged UI/localization
passes. The owner reports Ads create/rename/delete verified in Ads Manager;
that bounded live evidence does not prove every Ads operation, cleanup or MCP.
Historical production records include the 40/40 recipe publications and comments
and a scratch-database rollback drill, not a proxy cutback or latest-release restore.

Still missing at this HEAD: installed Instagram support, Facebook Groups,
AI agent management and asynchronous Posts CSV. Shared validation Root delivery,
AppShell workspace confirmation, migration rehearsal/Ads inventory data controls,
current browser/FR/accessibility checks, live client execution and provider/data
coverage remain open. The requested LEGACY_SWEEP_2026-10-21.md is absent; its
additional missing rows must be reconciled when supplied. Never infer parity
from this incomplete route inventory.

Continue from [DELIVERY_PLAN.md](DELIVERY_PLAN.md) and
[AGENT_HANDOFF.md](AGENT_HANDOFF.md). Retain the full
[legacy inventory](LEGACY_CAPABILITY_PARITY.md) and release/recovery gates.
This docs worker runs local checks only; no servers, deploy, push or production.

## Legacy shell lane q-35 — 2026-10-22

Source update: installable app shell (dynamic public branding/manifest, offline-only service worker, icons and bilingual Appearance controls), global cross-site mutation middleware and neutral likes-versus-followers growth identity are implemented in the working tree. See [PLATFORM_SHELL_Q35.md](PLATFORM_SHELL_Q35.md) for exact evidence and remaining checks. New Root key: `settings.webApp`; integrator must bump CONFIG_SCHEMA_VERSION (unchanged here). Existing `meta.metricLabels` and `analytics.overviewCopy` gain copy entries with saved-catalog compatibility. No new database table, migration, background job or provider write. Browser service workers are local browser infrastructure; existing audience synchronization stays under shared worker leases/run history. No server, deploy, commit, push or production action was authorized in this lane. These source changes do not close real browser/provider/release gates or unrelated historical gaps. Facebook Groups are dropped by owner decision 2026-10-22; historical missing-feature statements above do not authorize Groups work.

## Operator monitoring follow-up (2026-10-22)

Source adds module-owned Root monitoring (UI/REST/MCP shared authorization,
exact confirmation and audit), incident evaluation, observed-minute uptime,
and a persisted email outbox that never automatically replays uncertain sends.
The dedicated worker and independent web observer share leases/run history;
web monitoring cannot publish or write worker heartbeats. Worker failures feed
the existing scrubbed error console. Release/recovery readiness probes now use
`/api/health`; scripts were not executed against any host.

New migration `20261022180000_rebuild_uptime_samples` adds minute claims and
monitoring delivery records; apply/rehearse it before enabling monitoring.
New Root keys are listed in the operator lane verification note. Schema version
is deliberately unchanged for the integrator. Telegram, provider usage alerts,
test-alert parity and real database/browser/mail/release evidence remain open.
See `OPERATOR_MONITORING_2026-10-22.md` for scope and current verification.


Fresh operator-lane verification: `npx tsc --noEmit -p .` and
`npm run typecheck` passed with zero errors; 113 focused tests across 12 files
passed, including parity/config guards. Final full suite (only the requested
Facebook diagnostic transport exclusion, cache disabled): 658 files passed,
one failed, 49 skipped; 10,174 tests passed, five failed, 2,159 skipped. All five
failures are loopback `facebook-native-http` tests blocked by sandbox
`listen EPERM ::1`; the full suite is not green. Both release scripts pass
`bash -n`; whitespace checks pass. Work remains uncommitted as requested.
