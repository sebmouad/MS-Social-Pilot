# Data-control ownership audit (2026-10-21)

Binding target: `rebuild/docs/ARCHITECTURE_CONTRACT.md`. This audit covers every
CREATE TABLE in `rebuild/prisma/migrations/20261020*` and later, including future-dated
migration names already in source. No migration was applied by this lane.

| Table | Export/erasure ownership |
| --- | --- |
| `ai_videos` | Workspace FK: catalog export/counts/dependency-ordered erasure |
| `OAuthClient` | Dropped by the lane-47 server cleanup (replaced by `mcp_oauth_clients`; zero rows, no rebuild reader) |
| `OAuthCode` | Dropped by the lane-47 server cleanup (replaced by `mcp_oauth_codes`; zero rows; export/erase hooks removed) |
| `changelog_entries` | Installation release notes, retained |
| `rebuild_monitoring_deliveries` | Installation incident delivery claims and safe outcomes only, no customer content; retained operational history |
| `rebuild_uptime_samples` | Installation uptime minute idempotency; no customer identifiers; retained for the Root-configured monitoring history window |
| `rebuild_job_leases` | Installation worker coordination, retained |
| `rebuild_sync_runs` | Installation worker run history, retained |
| `workspace_data_purges` | Retained erasure recovery state, deliberately excluded from content erasure |
| `task_comments` | Workspace FK: catalog export/counts/dependency-ordered erasure; author FK SET NULL on account deletion |
| `mcp_oauth_clients` | Installation client registration, retained |
| `mcp_oauth_codes` | Workspace FK: catalog export/counts/dependency-ordered erasure; personal safe-metadata export hook; user FK cascade |
| `rebuild_workspace_exports` | Workspace FK: catalog export/counts/dependency-ordered erasure; deletion queues file cleanup |
| `rebuild_export_file_cleanups` | Retained deletion outbox without workspace FK; must survive erasure for Settings export worker cleanup |
| `rebuild_channel_profiles` | Indirect target ownership: explicit export/counts/delete before targets |
| `rebuild_workspace_watermarks` | Workspace FK: catalog export/counts/dependency-ordered erasure |
| `person_mcp_keys` | Account safe-metadata export hook; user FK cascade. Workspace erasure retains these account-wide credentials |
| `rebuild_facebook_native_schedule_changes` | Workspace FK: catalog export/counts/dependency-ordered erasure; publishing recovery guard still applies |
| `rebuild_facebook_sync_cursors` | Workspace FK: catalog export/counts/dependency-ordered erasure before targets |
| `wordpress_recipe_sources` | Workspace FK: catalog export/counts/dependency-ordered erasure after plans |
| `wordpress_recipe_plans` | Workspace FK: catalog export/counts/dependency-ordered erasure before sources/targets |
| `ads_objects` | Explicit indirect export via workspace-owned ad accounts, with recursive credential redaction and row counts. Erased by its ad-account FK cascade. Real PostgreSQL cascade/export proof remains separate. |
| `task_checklist_items` | Workspace FK: catalog export/counts/dependency-ordered erasure; composite task FK cascade on task/workspace deletion; author FK SET NULL on account deletion |
| `metric_alert_rules` | Workspace FK: catalog export/counts/dependency-ordered erasure; channel FK cascade on channel deletion; author FK SET NULL on account deletion |
| `metric_alert_firings` | Workspace FK: catalog export/counts/dependency-ordered erasure; rule FK cascade on rule deletion |
| `meta_webhook_deliveries` | Installation inbound-webhook delivery receipts (ids, kinds, verbs, counts; never message text); retained operational history under the Root-configured retention window, like `rebuild_sync_runs` |
| `analytics_rollup_daily` | Workspace FK: catalog export/counts/dependency-ordered erasure; channel FK cascade on channel deletion |
| `analytics_rollup_weekly` | Workspace FK: catalog export/counts/dependency-ordered erasure; channel FK cascade on channel deletion |
| `analytics_rollup_runs` | Workspace FK: catalog export/counts/dependency-ordered erasure; worker coverage history only |

Account appearance is not a new table: `users.theme` and the exact
`app_settings` key `settings.appearance.user.<userId>.mode` belong to the account.
Workspace erasure retains them, and a workspace administrator's export must not
reveal members' account-wide preferences or person credentials. The supplementary
account export includes stored choices (without substituting Root defaults);
account erasure deletes the exact mode key, while deleting the user removes theme.
No prefix matching is used, including for IDs containing dots or SQL wildcards.

Workspace exports redact credential fields recursively, including OAuth hashes
and challenges. Account hooks project safe credential metadata explicitly.
Secrets, installation operational records and erasure recovery state are not
promised as exported customer content. Existing export completeness remains false.

## Follow-up implementation (2026-10-21)

`deleteRootUser` and `deleteUnverifiedRegistration` now call
`deleteAccountSupplementaryData(tx, userId)` after authorization/eligibility locks
and immediately before deleting the user, in the same transaction. Failure aborts
the deletion. Exact-key appearance cleanup remains account-scoped; workspace
data is retained. (The legacy OAuth-code deletion was removed with its table
in lane 47.)

`src/modules/settings/server/account-export.ts` provides `exportAccountData`.
The shared service requires current session, membership, Settings account read
permission and entitlement. It rechecks/locks the active session and account in
its transaction, explicitly projects profile metadata, calls the supplementary
export hook and atomically audits the read without personal values. It reuses
`data.maxArchiveBytes` and the shared workspace-operation timeout/wait settings.
No new Root keys or schema-version changes are introduced. The JSON receipt has
UTF-8 byte size and explicit **partial** coverage; it includes profile, stored
appearance and safe credential/grant metadata, excluding workspace content,
media, passwords, secrets, authentication history, notification preferences and
audit history. It does not claim full personal-data portability.

`accountHttp(request, 'export')` prepares a private/no-store JSON attachment for
GET with no query parameters. `server/account-export-mcp.ts` declares the
session-only `ACCOUNT_EXPORT_MCP` group/tool `export_account_data`, calling that
same service. These are tested adapters; public registration and UI are pending.
No write confirmation is required for this authorized read.

The supplementary purge gates (squashed into the baseline from
`20261031150000_rebuild_supplementary_purge_gates`) add INSERT/UPDATE gates for
`rebuild_channel_profiles`, leaving DELETE available for erasure. They formerly
also gated the retired `OAuthCode` table; that trigger is dropped with the
table by the lane-47 server cleanup. The profile gate resolves target
ownership, locks the workspace first and rechecks/locks the target before
checking purge state. Existing historical orphans are not deleted and no
unaudited foreign keys are added.

## Integration required outside owned paths

The lane's ownership rule forbids the following files. Integration owner must:

- Add `src/app/api/settings/account/export/route.ts`, exporting GET that calls
  `accountHttp(request, 'export')` from the Settings server adapter.
- Import `ACCOUNT_EXPORT_MCP` from `./server/account-export-mcp` in
  `src/modules/settings/mcp.ts` and spread/register that group in `SETTINGS_MCP`.
  Keep session-only policy; workspace/person/OAuth keys cannot export account data.
- Add an Account screen download control using the same GET attachment endpoint;
  provide Root-editable English/French labels and accurate partial-coverage copy
  through Settings' `config.ts`/copy catalog. Include loading/error/retry/access
  states and browser checks. Map export error codes to this bilingual catalog as
  well: the new server adapters currently follow the existing account services’
  English safe-error pattern. No UI implementation or browser outcome is claimed.
- Broaden the description/label of `data.maxArchiveBytes` in Settings `config.ts`
  to cover both account JSON and workspace archives, since both consume it.
- Migration pins: done. The supplementary purge gates are squashed into the
  `20261103000000_baseline` migration, which the rehearsal checksum-pins and
  applies (lane 47).
- Update ARCHITECTURE.md, DELIVERY_PLAN.md and AGENT_HANDOFF.md with these source
  changes and remaining integration/database/browser proof. Do not describe the
  export adapters as publicly exposed until their host registration is merged.

## Follow-up verification

`npx tsc --noEmit -p .`: passed, zero errors. Targeted Vitest: 74 passed,
7 PostgreSQL tests skipped across 12 selected files (no
`REBUILD_PREVIEW_DATABASE_URL`). The run used `--no-cache` because the pre-existing
`node_modules` symlink points outside this worktree's writable sandbox. Coverage:
account export service/HTTP/MCP adapters, supplementary hooks, actual registration
admin integration, account service authorization, Root controls, migration
checksum/shape and migration-table inventory. Optional recent-table PostgreSQL
checks now include legacy OAuth/profile INSERT/UPDATE refusal for requested and
db_deleted states, completed-state writes and foreign-workspace preservation.
No migration, database-trigger runtime, concurrent PostgreSQL, server, browser,
provider or production outcome is established by this run.

## Evidence

Unit tests exercise workspace export, recursive secret redaction and exact account
scope. PostgreSQL-optional tests use rollback-only synthetic records on a guarded
loopback `_preview` database. They verify actual catalog discovery, export counts,
purge-trigger refusals, children-first deletion, foreign-workspace preservation,
account preference cleanup and user-FK cascades. Without
`REBUILD_PREVIEW_DATABASE_URL`, these tests skip; no live PostgreSQL outcome is
claimed. No server, deploy, push or production operation belongs to this lane.

## Writing agents and private Posts CSV storage

| Table | Ownership and lifecycle |
| --- | --- |
| `rebuild_writing_agents` | Workspace writing briefs; workspace cascade, user references retain authorship. |
| `rebuild_writing_agent_runs` | Workspace content-free generation history; deleted agent reference is nulled. |
| `rebuild_post_exports` | Workspace/user private CSV with expiry and current-access download checks; cascades on workspace/user deletion. |
| `rebuild_post_export_runs` | Content-free export attempt history; cascades with its export/workspace/user. |
| `rebuild_chat_deliveries` | Notifications-owned content-free event outbox. Direct workspace FK enables catalog-driven export and children-first erasure; channel deletion cascades delivery rows. Unique workspace/channel/event identity suppresses duplicate intents. Sending claims become uncertain after expiry and are never automatically replayed. The `20261022190000_rebuild_chat_deliveries` source is squashed into the baseline. |

Portability and retained-account erasure coverage require integration by the data-control owner; table registration alone is not proof of full coverage.

## Owner ZIP portability lane (2026-10-22)

`archive.ts` now derives `channels.json`, `posts.json`, `posts.csv`,
`schedule.json`, `analytics/channels.csv` and `comments.json` from the same
authorized, recursively scrubbed `exportWorkspaceData` result. These restore
the useful legacy portable files alongside the full `database/workspace.json`
and stored media. Neutral channel names replace provider-specific file naming;
machine field names and archive filenames are versioned format identifiers.
The manifest lists the exact files and CSV formula protection. UTF-8, quoted
newlines, destinationless drafts, first comments, label joins, destination
status/times and object-valued insights are covered by synthetic tests.
Spreadsheet formula cells gain a leading apostrophe in CSV only; JSON retains
the original content. Existing archive byte and ZIP32 limits still apply to all
new entries. A larger portable archive may therefore be refused at the existing
Root size limit rather than silently omitting data.

`index.ts` additionally exports `ads_objects` through the workspace's
`ad_accounts`. This export-only ownership path does not change erasure order.
All existing UI, REST and MCP ZIP downloads receive these additions through
the existing shared request/build/download services, confirmations and audit.
There is no second export endpoint or new data-control Root setting.

Evidence: `src/modules/agency/export-{legacy-parity,inventory,archive}.test.ts`
(13 tests), existing data-control/archive/deletion-order/export-job/surface
tests and parity guard pass. Inventory tests cover owner/admin success,
editor/contributor/viewer/client/no-membership refusal and cross-workspace
denial. Actual PostgreSQL, disk concurrency, browser download and live-client
verification have not run. `coverage.complete` and `database.complete` remain
false: these additions close bounded portability gaps, not the complete
customer-data export/erasure contract.
