# Alerts/operator lane: integration handoff

Status: **staged source and mocked/DOM evidence; incomplete and not release-ready**.
Only `src/modules/notifications/chat-channels/**` and `src/app/root/alerts/**`
were edited. No server, browser, database, provider, production, deployment or
push was run. The ownership clarification did not receive an answer; no expanded
file ownership was inferred. `CONFIG_SCHEMA_VERSION` is unchanged.

## Implemented source

- Chat destinations: encrypted create, enabled/events update, delete, list and
  one-shot Slack/Telegram tests. Every entry adapter uses `server/service.ts`.
  Current membership, user status, tenant suspension, entitlements, feature
  permissions, workspace purge and unrestricted workspace scope are checked in
  the service. Mutations serialize on the workspace, lock current membership and
  recheck authority. Writes and their content-free activity audit share a
  transaction. Reads never return secrets or raw legacy delivery errors.
- Transport pins approved service origins, validates credential shapes, refuses
  redirects, consumes Root timing and requires semantic success receipts.
  Delivery is accepted/rejected/uncertain; there are no automatic retries.
- Root incidents: `server/alerts.ts` reconciles rebuild-only worker heartbeat,
  publication failures, backup health and disk space into `system_alerts`.
  Unknown measurements never resolve incidents. Transaction advisory locks
  serialize each incident key; existing open rows suppress duplicate openings.
  Root authority is separate from workspace roles and rechecked under lock.
- Root test: durable audited intent precedes one email and optional Telegram
  test. Its receipt distinguishes sent/failed/unavailable/uncertain outcomes and
  secondary audit failure. Workspace MCP credentials cannot invoke Root tools.
- Bilingual team-chat UI plus the thin `/root/alerts` page and server action.
  Root copy and operation policy declarations are staged, **not registered**.
  Root alerts therefore displays its unavailable state until integration.

Chat creation intentionally does not auto-send: the user separately confirms
the exact test action through UI, REST or MCP. This changes legacy's automatic
post-create test, giving all three surfaces identical consent behavior.

## Files

All paths in this list are relative to this directory unless otherwise stated.

- `config.ts`, `alerts-config.ts`: typed policy/catalog entries and schemas.
- `contracts.ts`, `manifest.ts`: request shapes, shared exact confirmations,
  existing Settings feature ownership and proposed screen route.
- `server/policy.ts`, `server/service.ts`, `server/transport.ts`: configuration,
  authorized chat persistence, audit and external delivery.
- `server/alerts.ts`: Root incident reconciliation, safe history and delivery test.
- `http.ts`, `mcp.ts`: chat REST adapters and workspace MCP declarations/executor.
- `alerts-http.ts`, `alerts-mcp.ts`: installation-only REST/MCP adapters.
- `ui/ChatChannelsScreen.tsx`, `ui/ChatChannels.tsx`,
  `ui/chat-channels.module.css`: team chat screen.
- `ui/SystemAlertsScreen.tsx`, `ui/SystemAlerts.tsx`: Root alerts screen.
- `tests/service.test.ts`, `tests/transport.test.ts`, `tests/alerts.test.ts`,
  `tests/http.test.ts`, `tests/ui.test.ts`, `vitest.config.ts`: lane-owned checks.
- `README.md`: this handoff.
- Outside this directory, still inside ownership:
  `src/app/root/alerts/page.tsx` and `src/app/root/alerts/actions.ts`.

## Required integration edits outside ownership

1. **Root registration:** in `src/modules/installed-config.ts`, import
   `CHAT_CHANNELS_CONFIG` from `./notifications/chat-channels/config` and spread
   it into `INSTALLED_MODULE_CONFIG`. It includes `SYSTEM_ALERTS_CONFIG`.
   The config-validation failure names precisely these five missing keys:
   - `notifications.chatPolicy`
   - `notifications.chatCopy`
   - `notifications.systemAlertPolicy`
   - `notifications.systemAlertCopy`
   - `notifications.systemAlertTelegramToken` (secret)
   The integrator owns any schema-version bump. Do not bypass the guard or
   replace literal keys to conceal the missing registration.
2. **Workspace MCP:** import/spread `CHAT_CHANNELS_MCP` in
   `src/modules/installed-mcp.ts`. These are workspace-wide tools, refused for
   restricted credentials, using existing `settings/notifications` permissions.
3. **Installation MCP:** in `src/server/mcp/root-tools.ts`, aggregate
   `systemAlertToolDefinitions` and delegate matching calls to
   `executeSystemAlertTool`. Add tool names to the installation-only dispatch,
   write classification and resources using the host's existing conventions.
   Do not add this group to workspace MCP. Definitions alone are not delivery.
4. **REST route wrappers:**

   | Route | Export from owned file | Shared service |
   | --- | --- | --- |
   | `api/chat-channels` GET/POST | `GET`, `POST` from `http.ts` | `listChatChannels`, `createChatChannel` |
   | `api/chat-channels/[id]` PATCH/DELETE | `PATCH`, `DELETE` from `http.ts` | `updateChatChannel`, `deleteChatChannel` |
   | `api/chat-channels/[id]/test` POST | `TEST as POST` from `http.ts` | `testChatChannel` |
   | `api/root/alerts` GET | `GET` from `alerts-http.ts` | `listSystemAlerts` |
   | `api/root/alerts/check` POST | `CHECK as POST` from `alerts-http.ts` | `checkSystemAlerts` |
   | `api/root/alerts/test` POST | `TEST as POST` from `alerts-http.ts` | `testSystemAlert` |

5. **Customer route/navigation:** create
   `src/app/settings/notifications/chat-channels/page.tsx` as a re-export of
   `ui/ChatChannelsScreen`; link it from the existing Notifications screen for
   authorized managers. Add `/root/alerts` to the Root manifest navigation.
6. **Tests:** the main Vitest configuration includes only `tests/**/*.test.ts`.
   Move these five tests into that owned test tree (adjust relative imports), or
   include the lane test pattern in the main configuration. Until then explicitly
   run the lane config shown below in addition to the required full suite.
7. **Automatic delivery remains absent:** connect existing publishing,
   connection-expiry, approval and client-review event producers to a durable
   chat outbox and worker. Implement idempotency, uncertain-outcome holding and
   current workspace/resource authorization before sending. The current code
   manages subscriptions and sends explicit tests; saved subscriptions do not
   yet deliver real events. Do not wire a provider send into a transaction that
   produces a business event, or claim that automatic notifications are done.
8. **Automatic Root alerts remain absent:** schedule Root incident collection
   under a documented worker installation identity and deliver opening/recovery
   notifications once, with durable outcome evidence. Current checks are
   explicit Root commands. Account-disconnected/expiring and provider-usage
   checks remain open. A dead worker needs an independent heartbeat observer;
   scheduling its own down-check only in that worker cannot meet legacy behavior.
9. **Facebook owner:** implement `graph_usage` projection and app credential
   diagnostics under `src/platforms/facebook/**`, then add thin `/root/meta/usage`
   and app-check entries, API and installation MCP mappings. Existing platform
   diagnostics checks configuration/connection identity/grants/discovery; that
   does not establish full legacy app-check or Graph usage parity. No Facebook
   code was placed in the notifications module or shared host. No Groups added.
10. **Root owner:** complete `/root/status` uptime/current-state view and worker
    run detail via shared service/UI/API/installation MCP. Existing
    `loadRootOperations` is reused for heartbeat checks; that alone does not
    complete status/worker parity. These routes are outside the listed ownership.
11. **Data controls/docs:** no new table or SQL migration is needed for current
    source: `chat_channels` and `system_alerts` retain the legacy rows; encrypted
    chat secrets use the same v1 AES-GCM envelope and bootstrap encryption key.
    Actual legacy-data reads/decryption and row counts have not been tested.
    Data-control ownership/export/erasure documentation currently has no explicit
    `chat_channels`, `system_alerts` or `graph_usage` mapping. Review/add coverage
    and verify cleanup before release. No import script or schema change is
    claimed necessary without a database inspection.
12. Update `docs/MCP_PARITY.md` with the service/UI/API/tool mappings below;
    update `docs/ARCHITECTURE.md`, `docs/DELIVERY_PLAN.md` and
    `docs/AGENT_HANDOFF.md` with the integration status. The relevant
    `docs/LEGACY_SWEEP_2026-10-21.md` rows must stay **partial**, not done, until
    actual registration, automatic delivery and all requested operator features
    have been implemented and verified. Those documents are outside ownership.

## MCP mapping rows for integration

| UI action | REST | MCP | Shared service |
| --- | --- | --- | --- |
| Chat destination list | GET `/api/chat-channels` | `list_chat_channels`, `msp://settings/chat-channels` | `listChatChannels` |
| Add destination | POST `/api/chat-channels` | `create_chat_channel` | `createChatChannel` |
| Pause/enable/edit subscribed updates | PATCH `/api/chat-channels/[id]` | `update_chat_channel` | `updateChatChannel` |
| Delete destination | DELETE `/api/chat-channels/[id]` | `delete_chat_channel` | `deleteChatChannel` |
| Send test | POST `/api/chat-channels/[id]/test` | `test_chat_channel` | `testChatChannel` |
| Root incident history | GET `/api/root/alerts` | `list_root_system_alerts` | `listSystemAlerts` |
| Root incident check | POST `/api/root/alerts/check` | `check_root_system_alerts` | `checkSystemAlerts` |
| Root test alert | POST `/api/root/alerts/test` | `test_root_system_alert` | `testSystemAlert` |

Every write service checks the same exact confirmation for every caller. Chat
changes audit into `activity_logs`; Root changes audit into `root_activities`.
These are staged mapping rows, not a claim that the host routes/tools are live.

## Design evidence and limits

- **Team chat screen:** taste-skill app rules retain the existing brand, flat
  surfaces, restrained type, honest delivery states and service icons on actual
  destinations. Web Design Guidelines: semantic labeled controls, masked
  credentials, focusable live feedback, named tables, mobile stacking, localized
  validation and exact-confirmation dialogs. Composition patterns: explicit
  screen/client separation, shared DataTable/Button/useConfirm, no boolean mode
  flags. React best practices: parallel server reads, serializable date props,
  no client credential fetching, immediate submission locks and validated
  receipts. Users see a readable destination table with expandable event editing
  and a spacious responsive add form. Dates use the workspace timezone.
- **Root alerts screen:** taste-skill keeps real incident rows, flat shared
  tables and distinct unknown/open/resolved states. Web Design Guidelines:
  keyboard-operable shared dialogs, exact typed consent, live feedback and
  explicit delivery outcomes. Composition patterns use one domain service with
  thin page/action adapters and shared controls. React best practices parallel
  independent reads and keep configuration/secrets server-side. Users see
  incident opening/recovery times with check/test controls in the contextual
  sidebar; dates use Root's configured operational timezone.
- No server or browser was run, as instructed. DOM tests are not screenshot,
  theme-contrast, layout, responsive-browser or live-provider verification. No
  changed screen is claimed visually cleared or release-ready.

## Verification commands

Run from `rebuild/`:

```sh
npx tsc --noEmit -p .
npx vitest run --config src/modules/notifications/chat-channels/vitest.config.ts --no-cache
npx vitest run tests/parity-guard.test.ts tests/config-validation.test.ts tests/raw-sql-void-guard.test.ts --no-cache
npx vitest run --exclude "**/facebook-diagnostic-transport.test.ts" --no-cache
```

`--no-cache` avoids writes into the pre-existing externally linked node_modules
cache. Results and remaining failures are reported in the final worker report;
the full suite cannot pass the new-key registry guard until step 1 is integrated.

Final local results (2026-10-22; source/mocks/DOM only):

- TypeScript: exit 0, zero errors.
- Lane config: 5 files, 48 tests passed. Main suite does not include these files.
- Parity guard: 22/22 passed; SQL void-lock guard: 1/1 passed.
- Config validation: 6/7 passed; its missing-key guard fails on the five new
  declarations awaiting the shared aggregator edit described above.
- Required whole suite, with the named diagnostic transport exclusion and
  caching disabled: 652 files passed, 2 failed, 49 skipped; 10,141 tests passed,
  6 failed, 2,153 skipped. One failure is the missing-key registry guard; five
  are `facebook-native-http.test.ts` loopback tests blocked by sandbox
  `listen EPERM ::1`. The corrected SQL-lock guard passes in this final run.
- An earlier full run also encountered a ZIP temporary-file `EINVAL`; it did
  not recur in the final full run. No environment workaround was added.
- Existing untracked patch files and node_modules symlinks are untouched.
  Changes remain uncommitted and unpushed for the integrator, as requested.
