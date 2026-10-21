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

## Integration required outside owned paths

`account.ts` contains persistence hooks, not public services. An authorized
account export service must call `exportAccountSupplementaryData(tx, userId)` in
its transaction. No account-export service/transport was found in the rebuild;
workspace export is not a substitute.

In `src/server/root/user-controls.ts` (`deleteRootUser`), call
`deleteAccountSupplementaryData(tx, userId)` after account lock/authorization and
immediately before `DELETE FROM users`, in the same transaction. Do the same in
`src/modules/settings/server/registration.ts` (`deleteUnverifiedRegistration`),
and in any future self-service deletion. Without these calls the mode key and
legacy OAuth codes remain orphaned. These files are outside this lane's ownership.

`OAuthCode` has no workspace purge trigger or user/workspace FK. Add a separately
reviewed migration installing the shared purge write gate (and tenant/user FKs
only after checking old orphan records); this lane does not alter migrations.
`rebuild_channel_profiles` likewise has no database purge-write trigger: its
indirect ownership needs a target-aware gate if database-level protection is
required. Existing service guards must remain in place.

The integration owner should update ARCHITECTURE.md, DELIVERY_PLAN.md and
AGENT_HANDOFF.md with this coverage and the remaining account-hook wiring; those
documents are outside this lane's owned paths.

## Evidence

Unit tests exercise workspace export, recursive secret redaction and exact account
scope. PostgreSQL-optional tests use rollback-only synthetic records on a guarded
loopback `_preview` database. They verify actual catalog discovery, export counts,
purge-trigger refusals, children-first deletion, foreign-workspace preservation,
account preference cleanup and user-FK cascades. Without
`REBUILD_PREVIEW_DATABASE_URL`, these tests skip; no live PostgreSQL outcome is
claimed. No server, deploy, push or production operation belongs to this lane.
