# Active delivery goal

Updated 2026-10-22 (lane 47), registry schema **135**.
**Status: active; incomplete.** The owner recorded production cutover on
2026-10-20; current deployed SHA/schema were not re-observed by this lane.
The legacy tree was deleted from the repository on 2026-10-22; server-side
legacy removal is still pending.

Deliver the full modular, platform-neutral application in `rebuild/` under
[ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md): preserve useful
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

Still missing: installed Instagram support, AI agent management and
asynchronous Posts CSV. (Facebook Groups were dropped by owner decision
2026-10-22; Meta removed the Groups API. They are not missing work.) Shared
validation Root delivery, AppShell workspace confirmation, current
browser/FR/accessibility checks, live client execution and provider/data
coverage remain open. [LEGACY_SWEEP_2026-10-21.md](LEGACY_SWEEP_2026-10-21.md)
is present; reconcile its rows before claiming completion. Never infer parity
from an incomplete route inventory.

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

The `20261022180000_rebuild_uptime_samples` source (minute claims and
monitoring delivery records) is squashed into the `20261103000000_baseline`
migration (lane 47).
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

## Lane 43 local follow-up evidence

Raw caption variants, transactional chat event delivery and consolidated Root
monitoring are implemented at source with schema 131. See
[LANE_43_FOLLOWUPS.md](LANE_43_FOLLOWUPS.md) for files, settings and verification.
The latest full suite has 11,373 passing tests and five sandbox-blocked localhost
transport tests; it is not green. Migration, browser and real delivery gates stay
open. The overall rebuild goal remains incomplete.

## Lane 47 legacy removal (2026-10-22)

Legacy root paths deleted from the repository; migration history squashed into
the `20261103000000_baseline` migration (equivalence proven on scratch
databases); `OAuthCode` hooks and the old migration-expectation helper removed;
`scripts/server-legacy-cleanup.sh` produced for the pending server-side
removal and five table drops. No new Root keys; schema stays 135. See
[ARCHITECTURE.md](ARCHITECTURE.md#lane-47-legacy-removal--2026-10-22) and the
lane-47 report. Work remains uncommitted as requested for this lane.
