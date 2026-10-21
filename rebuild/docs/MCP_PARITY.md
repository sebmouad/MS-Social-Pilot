# UI, REST and MCP parity inventory

Updated 2026-10-21 against local HEAD `6fb0e57f`. This is a **source-level**
inventory using module MCP declarations, HTTP routes, shared services and the
lane matrices. It is not a fresh tools/list dump, real MCP-client run, database,
browser or provider verification. Full parity remains **partial**.

The target is identical capabilities and service-owned authorization, tenant and
resource scope, confirmations and domain audit through UI, REST and MCP. A tool
name or a transport-only confirmation is insufficient. Session, workspace-key,
selected-resource, person-key and installation authority remain distinct.

## Per-module status

| Module | Shared source coverage across UI / REST / MCP | Status and remaining limits |
| --- | --- | --- |
| Home | `readHomeOverview`, GET `/api/home/overview`, `get_home_overview` | Present; workspace-wide read intentionally refuses resource-limited keys |
| Publishing | Drafts, create/edit/import, lists/search/export, publish/retry/sync, schedule/reschedule/cancel/queue, approvals, deletion/recovery, first-comment send/retry/record, templates/labels/fields/notes/versions, saved views, mix/recycle/best times/media | Broad source coverage. Per-destination schedule modes flow through session REST, key REST v1 and MCP. v1 create retains a no-confirmation contract; confirmation uniformity and real scheduling/provider evidence remain partial |
| Inbox | List/thread/sync/reply/resolve, nested replies/reviews, moderation/deletion/recovery, productivity, assignment/notes/saved replies and contact details | Broad source coverage; GET `/api/inbox/threads/[key]/details` calls `readInboxContactDetails` (added in `8852d367`). `bulkInboxAction` now has UI, `POST /api/inbox/bulk` and `bulk_inbox_action` (`f5c21c96`); mocked route tests only |
| Analytics | Overview/details/explorer/previous points, comparisons, posts/ad objects, demographics/history CSV, pins/goals, report exports/templates/schedules/runs/generation | Present at source; session HTTP and MCP share cores, key REST v1 delegates declared tools to host. Completeness of collected metrics and real transport/provider results remain unproven |
| Ads | Accounts/performance/directory/rows/exports/compare/status, creation choices, creative sources/image/create/assignment, change preview/apply/history/recovery | Present at source with session routes and key REST v1 through owning MCP groups. Live manager/grant/spend/creative outcomes remain partial |
| Settings connections | Directory/health, OAuth start, single/batch selection, disconnect preview/retain/delete | OAuth start UI/REST/session MCP share service; compatibility route also delegates. REST single/batch selection and disconnect now use confirmed module services; batch UI/MCP share selection wrapper. Single MCP selection and disconnect MCP still confirm outside the lower core; browser disconnect payload is stale. See explicit caller fixes below |
| Settings account/security/keys | Profile/password/session reads and changes; authenticator begin/enable/disable, passkey removal; workspace/person key list/issue/revoke | Session-only tools now exist; old claim that account/key issuance has no MCP is superseded. Bearer credentials cannot manage credentials/security. General authentication/passkey ceremony remains interactive |
| Settings appearance | `appearanceSession`, GET/PATCH `/api/settings/appearance`, `get_appearance`, `update_appearance` | Settings surfaces covered; shell ThemeProvider still writes cookies directly, layout ignores account theme when cookie absent. Whole-app same-service requirement remains partial |
| Settings workspace/data/notifications | Policy/operations, team/invitations, profiles/watermark, notification preferences/items, snapshot/ZIP/jobs/erasure | Broad source coverage. Snapshot JSON is partial; never equate it with complete ZIP export. Real data coverage, mail and concurrency need feature-specific proof |
| Media | Image/video library, usage/holders/quota, guarded import and delete | Shared service/API/MCP; complete UI workflows and storage/runtime proof still partial |
| Feeds | Source CRUD/check modes plus recipe read/save/preview/run/pause/resume | Shared UI/REST/MCP. Recipe tools: `get_recipe_source`, `save_recipe_source`, `preview_recipe_source`, `run_recipe_planner`, `set_recipe_source_state`. Feature off by default on new installs; production log records live source/image work and 80 scheduled posts. Facebook delivery/comments, full transport/browser/recovery evidence remain separate |
| AI | Assist availability/write tools and HTTP/UI; report recap and stored sentiment use AI service internally | Present for advertised assist; internal jobs are not separate customer writes. OpenAI/Gemini limited live checks do not prove every consumer |
| Tasks | List/create/checklist/update/move/delete/comments | Same `performTaskAction`; exact write confirmations now in service and sent by UI/REST/MCP. Real concurrent database and browser checks remain scoped gaps |
| Agency | Overview/export via shared service, session Clients and workspace selection | Separate read-only person keys exist for overview; workspace keys cannot expand to person-wide reads. Session Clients/switching are present, not granted to person keys; REST switch versus MCP confirmation difference remains |
| Sharing | Review/share link CRUD/rotate/revoke, feedback, eligible channels, bio controls | Shared UI/API/MCP source; copy-only edits remain version checked without confirmation, access changes confirmed. Browser/public provider/data coverage remains partial |
| Integrations | Webhooks/secrets/test/history, REST v1 and OAuth connector services | Session MCP secret reveal/rotate exist; bearer tools stay secret-free. OAuth browser consent is interactive. Not all module APIs are key-authenticated v1 endpoints |
| Root | Configuration, operations/diagnostics/health, users/workspaces/plans/audit/errors, registration, installation transfer, connection refresh/disconnect/recovery | Private UI/HTTP/installation-session MCP source coverage; workspace/person keys excluded. Backups UI is read-only; full operator inventory/configuration remains partial |

## Key-authenticated REST v1

`/api/v1/analytics/[operation]` and `/api/v1/ads/[operation]` use module-owned
`server/rest.ts` and Integrations `keyToolEndpoint` (`cf2938a1`). The allowlist is
made from owning MCP groups; the host retains feature/resource ceilings,
confirmations, locks and receipts. GET refuses writes; POST passes JSON arguments.
Errors preserve safe attempt metadata. See [INTEGRATIONS.md](INTEGRATIONS.md).
Mocked route/host tests are not a live key/client verification of every tool.

## Explicit remaining deviations

- Inbox bulk REST is implemented; verify actual client/scope/provider outcomes.
- Finish Settings caller wiring after `f5c21c96`: `src/modules/settings/mcp.ts`
  single `set_connection_selection` should call `changeConnectionSelections`;
  `src/modules/settings/connections-mcp.ts` disconnect should call
  `changeConnectionDisconnect` rather than confirming only in the executor.
  `src/modules/settings/ui/connections/manager.tsx` must send the named
  `DISCONNECT <id> RETAIN` or `DISCONNECT <id> DELETE RELATED DATA` phrase to REST;
  its current missing retain/short `DELETE` payload is refused. Wrapper tests
  validate accepted single/batch and disconnect input, not these caller paths.
- Route global theme changes through the appearance service, propagate its
  cookie policy and use saved account preference when a valid cookie is absent.
- Reconcile REST v1 Posts create's no-confirmation exception, Agency workspace
  switching and Sharing copy-only save policy with the binding service contract.
- Finish operational/configurable copy, localization and ownership gaps recorded
  in CONFIG_LITERAL_AUDIT.md; recheck after integration instead of repeating old
  lane claims (OAuth compatibility and batch-selection wiring are already fixed).
- Run a current cross-module auth/scope/confirmation matrix and actual MCP transport
  checks. Existing unit/render suites and older scoped probes do not prove all
  current module/credential combinations.

Authentication ceremonies, external provider consent and client-only navigation
have no equivalent autonomous tool operation; their underlying application
services/actions remain subject to the same authority. These boundaries do not
excuse missing customer capabilities.

Detailed matrices: [PARITY_PUBLISHING_INBOX.md](PARITY_PUBLISHING_INBOX.md),
[PARITY_ANALYTICS_ADS_SETTINGS.md](PARITY_ANALYTICS_ADS_SETTINGS.md). The current
source checks above supersede their stale integration warnings where named.

## Documentation follow-up verification — 2026-10-21

From `rebuild/`, `npx tsc --noEmit -p .` passed with zero errors. Targeted
`npx vitest run --no-cache` passed **60 tests / 6 files / zero skipped**:
`inbox-bulk-route` (18), `parity-connection-selection` (11),
`parity-connection-disconnect` (17), `ui-copy-coverage` (3),
`worker-shutdown` (6), `inbox-sync-fetch-then-write` (5), all under `tests/*.test.ts`.
These are source/mocked-unit/route checks; no fresh browser, PostgreSQL, real MCP
client, live provider or production evidence was collected. Only the eight owned
documents changed; no Root keys, schema version or source edits. No full suite,
servers, deploy or push. Architecture/delivery/handoff status updates are outside
this lane and must carry forward the caller and evidence gaps listed here.
