# Lane 43 follow-ups — 2026-10-22

Scope: close the caption-variant, chat event-delivery and duplicate Root-alert
leftovers on the current worktree. The architecture contract remains binding.
This lane leaves changes uncommitted and performs no deployment or production
operation, as explicitly requested. `briefs/_common.md` was not found in this
checkout; the supplied lane instructions and checked-in contracts govern.

Implementation batches:

1. Caption tests: accept raw captions through the existing caption-test service,
   create their posts through Publishing, and expose the same exactly confirmed
   operation in the bilingual screen, REST and MCP. Verify transaction rollback,
   role/resource boundaries and preserved input on failure.
2. Chat channels: enqueue content-free workspace events transactionally, deliver
   subscribed events through the existing leased notifications job, and persist
   per-destination claims. Never replay an uncertain external send. Move module
   tests into the main suite and verify tenant/subscription checks.
3. Root monitoring: retain one incident evaluator/outbox, merge alert testing into
   its UI/REST/MCP service, and deliver operator incidents to the active instance
   owner's workspace chat subscriptions as well as email. Remove the duplicate
   `notifications.systemAlert*` registry entries and bump the registry version
   once for the combined lane.
4. Integrate config/parity/data-control documentation, run targeted tests,
   TypeScript and the full requested Vitest suite, and record exact evidence and
   remaining runtime/browser/provider gaps below.

Implementation is complete at source. Unit and mocked tests do not establish
PostgreSQL, browser, live delivery or production outcomes.

## Configuration and integration

No new top-level Root keys. Registry schema is bumped from 130 to 131.

- `captionTests.policy`: `captionMaxCharacters` (10,000), `targetLimit` (20),
  `requestMaxBytes` (100,000). New fields default when loading older saved values.
- `captionTests.copy`: bilingual source selection, caption editing, channel-limit,
  empty-channel and exact-confirmation guidance; old custom labels are preserved.
- `notifications.chatPolicy`: `deliveryBatchSize` (25), `deliveryLeaseSeconds`
  (300), `ownerLimit` (50), with backward-compatible defaults and lease/transaction
  consistency validation.
- `notifications.chatCopy`: EN/FR `inboxAlert`, `operatorIncident` labels and their
  corresponding content-free message fields; old customized labels survive.
- `root.monitoringPolicy`: `chatWorkspaceId` (empty disables operator chat).
  Routing requires an active installation owner currently owning that workspace.
- `root.monitoringMailCopy`: defaulted EN/FR test subject.
- `root.monitoringCopy`: defaulted EN/FR test action, queued feedback and incident
  history fields.
- Removed registry keys: `notifications.systemAlertPolicy`,
  `notifications.systemAlertCopy`, `notifications.systemAlertTelegramToken`.
  This lane does not delete retained encrypted settings or automatically import
  their values into monitoring. Review Root thresholds and select chat routing.

Existing-post starts require `START CAPTION TEST`; raw variants require
`CREATE CAPTION TEST DRAFTS`; learning requires `LEARN <id>`. Root evaluation
requires `EVALUATE ROOT MONITORING`; test intent requires `TEST ROOT MONITORING`.
Legacy Root alert REST URLs delegate to the same monitor service and require its
canonical confirmations. Duplicate private MCP tools/resources are removed;
clients should use `get_root_monitoring`, `evaluate_root_monitoring`,
`test_root_monitoring`, and `msp://root/monitoring`.

## Verification and limits

From `rebuild/`, `npx tsc --noEmit -p .` passed with zero errors. Final full suite:
`npx vitest run --no-cache --exclude "**/facebook-diagnostic-transport.test.ts" --testTimeout 30000`.
Result: **700 files passed, one failed, 49 skipped; 11,373 tests passed, five
failed, 2,525 skipped**. All five failures are in `facebook-native-http.test.ts`:
Graph methods, multipart upload, oversized response, cancelled read and stalled
response timeout. Each fails before transport assertions because the sandbox
rejects its localhost socket with `listen EPERM ::1`. The baseline had the same
five failures. The requested full-suite-green gate remains blocked; no tests were
skipped or weakened to hide this limitation. Cache is disabled because the
pre-existing dependency symlinks point outside writable roots.

The independent integration run of smoke pages, French catalog quality,
configuration, parity and data-control migration inventory passed **786 tests
across five files**. The final aggregate targeted run passed **1,019 tests across 22 files**, including
every modified or newly added main-suite test plus French and data-control guards.
Both `npm run typecheck` and `npx tsc --noEmit -p .` passed with zero errors.
Final whitespace checks passed.

Apply/rehearse `prisma/migrations/20261022190000_rebuild_chat_deliveries` before
worker delivery. The new workspace-owned table has a composite tenant/channel
foreign key, event uniqueness and the shared purge write trigger; the data-control
README records ownership. Real PostgreSQL rollback, migration, purge concurrency,
export, Slack/Telegram/email delivery, browser themes/phone/accessibility and real
MCP execution were not run. Root tests acknowledge queued intent rather than
claiming delivery. Provider usage alerts remain unrelated open scope. No server,
deployment, production operation, stage, commit or push was performed.

No source edits outside the lane's authoritative owned paths are required. The
missing `briefs/_common.md` remains an input gap. Pre-existing untracked patch
files and dependency links were left untouched.

## Visible changes and required skills

| Screen | User-visible change | Applied skill rules |
| --- | --- | --- |
| Caption tests | Explicit existing-post/new-caption source, separate caption editors, channel selection/limit and shared link; typed consent explains draft-only creation. Failed requests retain text and confirmation. | Taste: established themed panels, purposeful hierarchy and module icons. Web guidelines: visible labels, shared AutoTextarea/FormValidation, associated field feedback and pending controls. Composition: shared Button/Dialog/form controls. React: thin authenticated action and minimal serialized channel choices. |
| Team chat notifications | Inbox and installation alert choices appear with the existing localized subscription checkboxes; saved events now feed delivery. | Taste: existing flat surfaces/icons. Web guidelines: labeled, keyboard-operable checkboxes and confirmation feedback. Composition: existing shared table/dialog. React: no new client fetch or separate screen state model. |
| Root Operations monitoring | Test action, queued-state feedback and bounded open/resolved incident history share the monitoring panel. The former Alerts page authenticates and redirects here. | Taste: restrained Tabler icons and flat themed tables. Web guidelines: semantic history, typed consent, pending disablement, retained failure context and focused EN/FR feedback. Composition: shared Button/useConfirm/DataTable. React: focused client action state and effect-based focus after rendering. |


## Changed files

`M` modified, `A` added, `D` removed. Moved chat tests appear as removal/addition.

- `A` `prisma/migrations/20261022190000_rebuild_chat_deliveries/migration.sql`
- `M` `rebuild/DESIGN.md`
- `M` `rebuild/UX-CONTRACT.md`
- `M` `rebuild/docs/AGENT_HANDOFF.md`
- `M` `rebuild/docs/ARCHITECTURE.md`
- `M` `rebuild/docs/DELIVERY_PLAN.md`
- `M` `rebuild/docs/GOAL.md`
- `A` `rebuild/docs/LANE_43_FOLLOWUPS.md`
- `M` `rebuild/docs/LEGACY_CAPABILITY_PARITY.md`
- `M` `rebuild/docs/LEGACY_SWEEP_2026-10-21.md`
- `M` `rebuild/docs/MCP_PARITY.md`
- `A` `rebuild/src/app/api/root/monitoring/test/route.ts`
- `D` `rebuild/src/app/root/alerts/actions.ts`
- `M` `rebuild/src/app/root/alerts/page.tsx`
- `M` `rebuild/src/lib/config/registry.ts`
- `M` `rebuild/src/modules/caption-tests/config.ts`
- `M` `rebuild/src/modules/caption-tests/copy.ts`
- `M` `rebuild/src/modules/caption-tests/mcp.ts`
- `M` `rebuild/src/modules/caption-tests/server/http.ts`
- `M` `rebuild/src/modules/caption-tests/server/service.ts`
- `M` `rebuild/src/modules/caption-tests/ui/CaptionTestsPage.tsx`
- `M` `rebuild/src/modules/caption-tests/ui/CaptionTestsScreen.tsx`
- `M` `rebuild/src/modules/notifications/chat-channels/README.md`
- `D` `rebuild/src/modules/notifications/chat-channels/alerts-config.ts`
- `M` `rebuild/src/modules/notifications/chat-channels/alerts-http.ts`
- `D` `rebuild/src/modules/notifications/chat-channels/alerts-mcp.ts`
- `M` `rebuild/src/modules/notifications/chat-channels/config.ts`
- `M` `rebuild/src/modules/notifications/chat-channels/contracts.ts`
- `D` `rebuild/src/modules/notifications/chat-channels/server/alerts.ts`
- `A` `rebuild/src/modules/notifications/chat-channels/server/delivery.ts`
- `D` `rebuild/src/modules/notifications/chat-channels/tests/alerts.test.ts`
- `D` `rebuild/src/modules/notifications/chat-channels/tests/http.test.ts`
- `D` `rebuild/src/modules/notifications/chat-channels/tests/service.test.ts`
- `D` `rebuild/src/modules/notifications/chat-channels/tests/transport.test.ts`
- `D` `rebuild/src/modules/notifications/chat-channels/tests/ui.test.ts`
- `D` `rebuild/src/modules/notifications/chat-channels/ui/SystemAlerts.tsx`
- `D` `rebuild/src/modules/notifications/chat-channels/ui/SystemAlertsScreen.tsx`
- `D` `rebuild/src/modules/notifications/chat-channels/vitest.config.ts`
- `M` `rebuild/src/modules/publishing/server/lifecycle.ts`
- `M` `rebuild/src/modules/root/config.ts`
- `A` `rebuild/src/modules/root/http.ts`
- `M` `rebuild/src/modules/root/manifest.ts`
- `M` `rebuild/src/modules/root/mcp.ts`
- `M` `rebuild/src/modules/root/monitoring-config.ts`
- `M` `rebuild/src/modules/root/server/operator-monitoring.ts`
- `M` `rebuild/src/modules/root/ui/MonitoringAction.tsx`
- `M` `rebuild/src/modules/root/ui/RootMonitoring.tsx`
- `M` `rebuild/src/modules/settings/notifications/producers.ts`
- `M` `rebuild/src/modules/sharing/server/deadlines.ts`
- `M` `rebuild/src/modules/sharing/server/public.ts`
- `M` `rebuild/src/server/data-control/README.md`
- `M` `rebuild/src/server/jobs/runtime.ts`
- `M` `rebuild/src/server/mcp/root-tools.ts`
- `M` `rebuild/tests/ai-content-tools-http.test.ts`
- `M` `rebuild/tests/ai-content-tools-ui.test.ts`
- `M` `rebuild/tests/caption-tests-service.test.ts`
- `A` `rebuild/tests/chat-channels-delivery.test.ts`
- `A` `rebuild/tests/chat-channels-http.test.ts`
- `A` `rebuild/tests/chat-channels-service.test.ts`
- `A` `rebuild/tests/chat-channels-transport.test.ts`
- `A` `rebuild/tests/chat-channels-ui.test.ts`
- `M` `rebuild/tests/config-validation.test.ts`
- `M` `rebuild/tests/mcp-installation-context.test.ts`
- `M` `rebuild/tests/operator-monitoring.test.ts`
- `M` `rebuild/tests/parity-guard.test.ts`
- `M` `rebuild/tests/publishing-lifecycle.test.ts`
- `A` `rebuild/tests/root-monitoring-action.test.ts`
- `A` `rebuild/tests/root-monitoring-consolidation.test.ts`
- `M` `rebuild/tests/root-monitoring-surfaces.test.ts`
- `M` `rebuild/tests/root-monitoring-ui.test.ts`
- `M` `rebuild/tests/sharing-deadlines.test.ts`
- `M` `rebuild/tests/sharing-public.test.ts`
- `M` `rebuild/tests/smoke-pages.test.ts`
