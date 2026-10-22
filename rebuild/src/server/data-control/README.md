# Data-control ownership audit (2026-10-21)

Binding target: `rebuild/docs/ARCHITECTURE_CONTRACT.md`. This audit covers every
CREATE TABLE in `prisma/migrations/20261020*` and later, including future-dated
migration names already in source. No migration was applied by this lane.

| Table | Export/erasure ownership |
| --- | --- |
| `ai_videos` | Workspace FK: catalog export/counts/dependency-ordered erasure |
| `OAuthClient` | Installation client registration, retained; not personal/tenant content |
| `OAuthCode` | No workspace/user FK: explicit tenant export/counts/delete; supplementary account export/delete hook |
| `changelog_entries` | Installation release notes, retained |
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
| `ads_objects` | Ad account FK with ON DELETE CASCADE: erased with its ad account; provider object identity only, no customer content |

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
the deletion. Exact-key appearance cleanup and legacy OAuth-code deletion remain
account-scoped; workspace data is retained.

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

Migration `20261031150000_rebuild_supplementary_purge_gates` adds INSERT/UPDATE
gates for `OAuthCode` and `rebuild_channel_profiles`, leaving DELETE available
for erasure. The legacy-code gate follows the shared workspace-lock/status policy
and also refuses missing workspace parents because no FK exists. The profile
gate resolves target ownership, locks the workspace first and rechecks/locks the
target before checking purge state. Existing historical orphans are not deleted
and no unaudited foreign keys are added. Migration is **unapplied** in this lane.
Reviewed SHA-256:
`f3f22b82d60a3bbbbacd5b152b3ceb577a3d39d126fd0ecdc09151e106f09768`.

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
- Pin the new migration in `rebuild/scripts/cutover-rehearsal.sh`: append its name
  to `approved_migrations`, add `verify_migration` with the exact checksum above,
  and apply it via `psql "$source_url" -q -v ON_ERROR_STOP=1 -f
  "$migration_dir/20261031150000_rebuild_supplementary_purge_gates/migration.sql"`
  after the existing WordPress migration. Extend the rehearsal's catalog checks
  to require both enabled triggers and their expected functions, plus a test of
  those script pins. This script is outside owned paths and was not modified.
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

Portability and retained-account erasure coverage require integration by the data-control owner; table registration alone is not proof of full coverage.
