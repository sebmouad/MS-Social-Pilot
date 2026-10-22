# Shared delivery plan

Updated 2026-10-21 against source HEAD `99c41554`, registry schema **123**.
[GOAL.md](GOAL.md) remains active; [ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md)
is unchanged. [ARCHITECTURE.md](ARCHITECTURE.md#current-head-reconciliation--2026-10-21)
and [AGENT_HANDOFF.md](AGENT_HANDOFF.md) separate current source from historical
browser, provider and production evidence. No new deployment is asserted here.

Current source includes Ads inventory independent of delivery (`e050b3a6`),
audit fixes and registered policies/catalogs (`8d9ccbe7`), separate paid/channel
Analytics, Home retained spend and richer UI (`d1702ef9`), stock aggregation
corrections and automatically discovered smoke tests (`99c41554`). The owner
reports create/rename/delete verified in Ads Manager. Record sanitized receipts
before treating that bounded run as an exhaustive Ads or release gate.

## Next reviewable batches

| Order | Work | Required evidence / owner |
| --- | --- | --- |
| 1 | Restore workspace picker integration | Shared shell owner sends exact SELECT WORKSPACE confirmation from AppShell; Agency service already enforces it. Test success/refusal and retained pending/error state. Sharing copy-only confirmation is now implemented. |
| 2 | Finish shared Root validation copy | Shared config/UI owner registers shared.formValidationCopy and delivers selected runtime copy to public/auth/customer/Root forms. storage.mediaPresentationPolicy, ui.loadingCopy and root.errorCopy are already registered. |
| 3 | Reconcile release/migrations/recovery | Release owner confirms deployed SHA/schema and migration receipts; pins ad.create and ads_objects migrations with checksum/order/history/probes in cutover rehearsal/tests. Verify latest-release backup/media restore, proxy cutback and worker drain; preserve one publisher. |
| 4 | Complete Ads inventory data controls and runtime proof | Data-control/Ads owners verify ads_objects export/erasure, cascade/transaction rollback and stale tombstones; external-removal reconciliation remains missing. Record live run levels/audit/confirmation/cleanup/spend, then test remaining operations and real scoped MCP. Review unrestricted-channel creation versus recovery policy. |
| 5 | Current design, FR and accessibility review | UI owners rerun synthetic Chromium/Firefox/WebKit for all themes/viewports, keyboard, language and failure recovery. Merged Settings/Root/Inbox/Publishing passes and shared CSS tests are source/DOM evidence. No completed two-round browser design proof; browser round 6 is partial. Fix hydration, soft 404s, raw messages and shell boundaries; remove smoke waivers only with evidence. |
| 6 | Numbers, performance and provider semantics | Provider/Analytics owners resolve Page-only Home performance, external destination deduplication, audience series identity and nested reactions. Verify real SQL/query plans/volume, selected scope and missing versus zero. Current arithmetic/query-budget fixtures prove bounded local behavior only. |
| 7 | Scheduling, feeds and portability | Publishing/Feeds/data owners prove mixed native/app scheduling, uncertain identity recovery, pause-cancel/retry, cross-slot allocation, source/notice delivery and export/erasure in actual databases/providers. Keep uncertain ledgers held; Home supply-card mount remains absent. |
| 8 | Finish legacy inventory and capabilities | Integrator supplies LEGACY_SWEEP_2026-10-21.md and reconciles every missing row. At current HEAD Instagram is helpers only; Groups, AI agent management and async Posts CSV are missing. Implement each with shared UI/REST/MCP service, Root config and scoped authorization evidence. |
| 9 | Cross-interface execution | Module/integration owners run the current owner/member/viewer/cross-workspace/resource/key/Root matrix and actual authenticated MCP client outcomes. Mocked host/service execution and the structural parity guard do not close this gate. |

## Evidence and delivery discipline

Dated production cutover/recipe/rollback records remain in
[RELEASE_GATES_PLAN.md](RELEASE_GATES_PLAN.md). The historical rollback drill
restored a scratch database and started artifacts on spare ports; it did not test
proxy cutback, media restore or the exact current migration set. Earlier local
browser matrices retain unresolved findings and their original merge coverage.
The latest smoke suite renders pages and invokes routes with synthetic mocks in
EN/FR; it does not run a server, browser, real database or provider.

Current schema is 123; this lane adds no Root keys and leaves the registry intact.
Module-owned services retain auth, tenant/resource scope, confirmations and audit;
Facebook logic remains platform-owned. Lane authority is eight owned docs only,
with full local suite/typecheck required and no servers, deploy, push or production.
Leave verified working-tree changes for integration; do not replay old release work.

## Legacy shell lane q-35 — 2026-10-22

Source update: installable app shell (dynamic public branding/manifest, offline-only service worker, icons and bilingual Appearance controls), global cross-site mutation middleware and neutral likes-versus-followers growth identity are implemented in the working tree. See [PLATFORM_SHELL_Q35.md](PLATFORM_SHELL_Q35.md) for exact evidence and remaining checks. New Root key: `settings.webApp`; integrator must bump CONFIG_SCHEMA_VERSION (unchanged here). Existing `meta.metricLabels` and `analytics.overviewCopy` gain copy entries with saved-catalog compatibility. No new database table, migration, background job or provider write. Browser service workers are local browser infrastructure; existing audience synchronization stays under shared worker leases/run history. No server, deploy, commit, push or production action was authorized in this lane. These source changes do not close real browser/provider/release gates or unrelated historical gaps. Facebook Groups are dropped by owner decision 2026-10-22; historical missing-feature statements above do not authorize Groups work.

Q-35 final verification: rebuild TypeScript zero errors; PWA/parity/config 67/67 and cross-site/audience/REST-MCP/UX 242/242 pass. Required full suite: 660 passed files, 1 failed, 49 skipped (10,288 passed tests, 5 failed, 2,191 skipped); all failures are unchanged facebook-native-http loopback `listen EPERM ::1`. Build blocked by Google Fonts DNS. New checks are green, but full-suite/build/browser release gates remain open. Changes left uncommitted.

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

## Lane 43 next checks

Source follow-ups for raw-caption tests, subscribed chat events and the single
Root monitoring/test flow are described in [LANE_43_FOLLOWUPS.md](LANE_43_FOLLOWUPS.md).
Before enabling delivery, rehearse/apply the chat outbox migration, review Root
monitoring settings after duplicate-key removal, select the owner workspace for
operator chat alerts, and verify real email/Slack/Telegram outcomes. Browser
checks for the new caption controls and Root test dialog remain open. No commit,
push, server or production action is authorized in this lane.
