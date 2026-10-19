#!/usr/bin/env bash
# Restore a sanitized custom-format staging dump into uniquely named local
# scratch databases, check the rebuild's mapped schema, then prove a second
# backup/restore preserves the data. This script never connects to production.
set -euo pipefail

fail() { echo "cutover rehearsal: $*" >&2; exit 1; }

: "${CUTOVER_STAGING_DUMP:?Set CUTOVER_STAGING_DUMP to a sanitized staging pg_dump -Fc file}"
: "${CUTOVER_ADMIN_URL:?Set CUTOVER_ADMIN_URL to a local PostgreSQL admin URL ending in /postgres}"
: "${CUTOVER_DUMP_SANITIZED:?Set CUTOVER_DUMP_SANITIZED=YES only after confirming the dump is sanitized}"
: "${CUTOVER_APPROVED_MIGRATION_SET:?Set CUTOVER_APPROVED_MIGRATION_SET to the reviewed migration set}"
[ "$CUTOVER_DUMP_SANITIZED" = YES ] || fail "CUTOVER_DUMP_SANITIZED must be YES"
approved_migrations='20261015120000_mcp_api_keys,20261023100000_rebuild_worker_jobs,20261016190000_rebuild_inbox_deletions,20261016220000_rebuild_post_deletions,20261017010000_rebuild_publication_attempts,20261017020000_rebuild_facebook_media_steps,20261017030000_rebuild_facebook_media_deletions,20261017040000_rebuild_facebook_media_resolution,20261018150000_rebuild_notifications,20261018170000_rebuild_ads_operations,20261018190000_rebuild_ads_creation,20261018193000_rebuild_purge_write_gates,20261025100000_rebuild_task_comments,20261018230000_rebuild_sharing_expiry,20261018233000_rebuild_mcp_resource_scope,20261019010000_rebuild_report_runs,20261019011000_rebuild_report_purge_gate'
[ "$CUTOVER_APPROVED_MIGRATION_SET" = "$approved_migrations" ] || fail "migration set must exactly match the reviewed staging allowlist"
[ -f "$CUTOVER_STAGING_DUMP" ] || fail "staging dump does not exist"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
migration_dir="$ROOT/prisma/migrations"
verify_migration() {
  local name="$1" expected="$2" path="$migration_dir/$1/migration.sql" actual
  [ -f "$path" ] || fail "reviewed migration is missing: $name"
  if command -v sha256sum >/dev/null; then
    actual="$(sha256sum "$path" | awk '{print $1}')"
  elif command -v shasum >/dev/null; then
    actual="$(shasum -a 256 "$path" | awk '{print $1}')"
  else
    fail "sha256sum or shasum is required to verify reviewed migrations"
  fi
  [ "$actual" = "$expected" ] || fail "reviewed migration checksum changed: $name"
}
verify_migration 20261015120000_mcp_api_keys 988d873c33229b439818d079d72c8bc49ffec93cbfe081ee4061ef93d2b2b3f4
verify_migration 20261023100000_rebuild_worker_jobs 5fb7962a2c720f8a3f30480c4c5afa6f0d48c92a8f2ee58047fb96ccf04a7205
verify_migration 20261016190000_rebuild_inbox_deletions 457327ad55d02af41eefe00f56021923abe5e13cf7ca668a96c064fa714acc57
verify_migration 20261016220000_rebuild_post_deletions 80e406ae33000a349d07f9e428563d20083bc36c65956a969a5e7ccc77c32f07
verify_migration 20261017010000_rebuild_publication_attempts 03973b6fb80dcf2580c5e39f0d2be8fd5715f47c1a953127ce939638bfece267
verify_migration 20261017020000_rebuild_facebook_media_steps 897464050aedf8c727fd695cc9b1fead0810d6c08606f3074c4d70529940a0e1
verify_migration 20261017030000_rebuild_facebook_media_deletions 3f5df63bf339fe532581f14738d089ca5f20a4c245f581f1587573b5bfe6cca5
verify_migration 20261017040000_rebuild_facebook_media_resolution 3227fbe5f381a25c87955ac809ef605fe1f2d51d9bb4f3ca4e5e9ce743c2a844
verify_migration 20261018150000_rebuild_notifications b60b92752dc3019e15156f1ecb4cb58d29b5de4a6676dd141ac13a955277b067
verify_migration 20261018170000_rebuild_ads_operations 61f575314590e45e8eafc7cb8088677fec2a78b39210b82187b6f2c05197d6d2
verify_migration 20261018190000_rebuild_ads_creation 749fc69e2937588b95e7b050ebb49525e30b2624915abd2bdc92de6e92a899d0
verify_migration 20261018193000_rebuild_purge_write_gates 5250ec9a2e1176d59f8dd97b6b86d622187b87bd2d3944c41c7a411d157b51d6
verify_migration 20261025100000_rebuild_task_comments 648427469b965c3c5572b131c4834f772f1fdfe6884a0fd8c32aebc3588750ea
verify_migration 20261018230000_rebuild_sharing_expiry 28d4f9da65ed866f6139aa982d4756906cd329080dccf6cf2d87dee32e59d263
verify_migration 20261018233000_rebuild_mcp_resource_scope 465a5d76679b45d7cb3fa6560b9d6a32501e56faab1922107547452a0b5519ab
verify_migration 20261019010000_rebuild_report_runs caa0c553569cf9f984e973ceb6e3ee858750209c6d2931e1316d3323b4357c4a
verify_migration 20261019011000_rebuild_report_purge_gate 122e813070361737ba1a89d775d2f92922dadd36423debb83411e0d5a4aa5d9e

# Only loopback TCP or the standard local PostgreSQL socket and database
# /postgres are accepted. A copied production DATABASE_URL must fail closed.
if [[ "$CUTOVER_ADMIN_URL" =~ ^postgres(ql)?://[^/@]+(:[^/@]*)?@(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?/postgres$ ]]; then
  base_url="${CUTOVER_ADMIN_URL%/postgres}"
  db_url() { printf '%s/%s' "$base_url" "$1"; }
elif [ "$CUTOVER_ADMIN_URL" = 'postgresql://postgres@/postgres?host=/var/run/postgresql' ]; then
  db_url() { printf 'postgresql://postgres@/%s?host=/var/run/postgresql' "$1"; }
else
  fail "admin URL must target loopback or the standard local socket and database /postgres"
fi
command -v psql >/dev/null || fail "psql is required"
command -v pg_restore >/dev/null || fail "pg_restore is required"
command -v pg_dump >/dev/null || fail "pg_dump is required"

suffix="$(date -u +%Y%m%d%H%M%S)_$$"
source_db="cutover_rehearsal_source_${suffix}"
restore_db="cutover_rehearsal_restore_${suffix}"
created_source=0
created_restore=0
cleanup() {
  if [ "$created_restore" = 1 ]; then psql "$CUTOVER_ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$restore_db\"" >/dev/null; fi
  if [ "$created_source" = 1 ]; then psql "$CUTOVER_ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$source_db\"" >/dev/null; fi
}
trap cleanup EXIT

psql "$CUTOVER_ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$source_db\""
created_source=1
source_url="$(db_url "$source_db")"
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$source_url" "$CUTOVER_STAGING_DUMP"

# The supplied dump must be a pre-migration baseline. Refuse already-applied
# or partially-applied targets so this run cannot silently skip or duplicate
# migration effects. Only these checksum-pinned SQL files are executed.
psql "$source_url" -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE already_applied boolean := false;
BEGIN
  IF to_regclass('public.workspace_data_purges') IS NULL THEN
    RAISE EXCEPTION 'workspace_data_purges prerequisite table is missing';
  END IF;
  IF to_regclass('public.mcp_api_keys') IS NOT NULL
     OR to_regclass('public.rebuild_job_leases') IS NOT NULL
     OR to_regclass('public.rebuild_sync_runs') IS NOT NULL
     OR to_regclass('public.rebuild_inbox_deletions') IS NOT NULL
     OR to_regclass('public.rebuild_post_deletions') IS NOT NULL
     OR to_regclass('public.rebuild_publication_attempts') IS NOT NULL
     OR to_regclass('public.rebuild_facebook_media_steps') IS NOT NULL
     OR to_regclass('public.rebuild_facebook_media_deletions') IS NOT NULL
     OR to_regclass('public.rebuild_facebook_media_resolutions') IS NOT NULL
     OR to_regclass('public.rebuild_notifications') IS NOT NULL
     OR to_regclass('public.ads_management_operations') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'share_links' AND column_name = 'expiresAt')
     OR to_regclass('public.task_comments') IS NOT NULL
     OR to_regclass('public.report_runs') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'rebuild_workspace_purge_write_gate' AND tgrelid = to_regclass('public.report_runs'))
     OR to_regprocedure('public.rebuild_facebook_media_deletions_binding_immutable()') IS NOT NULL
     OR to_regprocedure('public.rebuild_facebook_media_resolutions_immutable()') IS NOT NULL THEN
    RAISE EXCEPTION 'staging dump already contains reviewed migration objects; use a pre-migration sanitized baseline';
  END IF;
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name IN ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) AND finished_at IS NOT NULL AND rolled_back_at IS NULL)'
      INTO already_applied
      USING '20261015120000_mcp_api_keys', '20261023100000_rebuild_worker_jobs', '20261016190000_rebuild_inbox_deletions', '20261016220000_rebuild_post_deletions', '20261017010000_rebuild_publication_attempts', '20261017020000_rebuild_facebook_media_steps', '20261017030000_rebuild_facebook_media_deletions', '20261017040000_rebuild_facebook_media_resolution', '20261018150000_rebuild_notifications', '20261018170000_rebuild_ads_operations', '20261018190000_rebuild_ads_creation', '20261018193000_rebuild_purge_write_gates', '20261025100000_rebuild_task_comments', '20261018230000_rebuild_sharing_expiry', '20261018233000_rebuild_mcp_resource_scope', '20261019010000_rebuild_report_runs', '20261019011000_rebuild_report_purge_gate';
    IF already_applied THEN
      RAISE EXCEPTION 'staging dump migration history already contains an allowlisted migration';
    END IF;
  END IF;
END $$;
SQL
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261015120000_mcp_api_keys/migration.sql"
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261023100000_rebuild_worker_jobs/migration.sql"
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261016190000_rebuild_inbox_deletions/migration.sql"
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261016220000_rebuild_post_deletions/migration.sql"
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261017010000_rebuild_publication_attempts/migration.sql"
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261017020000_rebuild_facebook_media_steps/migration.sql"
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261017030000_rebuild_facebook_media_deletions/migration.sql"
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261017040000_rebuild_facebook_media_resolution/migration.sql"
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261018150000_rebuild_notifications/migration.sql"
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261018170000_rebuild_ads_operations/migration.sql"
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261018190000_rebuild_ads_creation/migration.sql"
# The purge gate function must exist before task comments install their trigger.
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261018193000_rebuild_purge_write_gates/migration.sql"
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261025100000_rebuild_task_comments/migration.sql"
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261018230000_rebuild_sharing_expiry/migration.sql"
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261018233000_rebuild_mcp_resource_scope/migration.sql"
# Report history needs the existing purge-gate function; install the table
# first, then attach its write gate in the following additive migration.
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261019010000_rebuild_report_runs/migration.sql"
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261019011000_rebuild_report_purge_gate/migration.sql"
echo "reviewed additive migrations applied to local scratch database"

# Required tables/columns are taken from rebuild/prisma/schema.prisma and
# reviewed raw-SQL journal queries. This verifies the client view against the legacy database layout without applying
# or generating DDL. The omitted legacy columns and tables remain untouched.
psql "$source_url" -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE item text[];
BEGIN
  FOREACH item SLICE 1 IN ARRAY ARRAY[
    ARRAY['share_links','expiresAt'], ARRAY['users','id'], ARRAY['users','email'], ARRAY['users','name'], ARRAY['users','passwordHash'], ARRAY['users','disabledAt'], ARRAY['users','isInstanceOwner'], ARRAY['users','totpSecret'], ARRAY['users','totpPendingSecret'], ARRAY['users','totpEnabledAt'], ARRAY['users','totpLastStep'], ARRAY['users','createdAt'], ARRAY['users','updatedAt'],
    ARRAY['sessions','id'], ARRAY['sessions','userId'], ARRAY['sessions','tokenHash'], ARRAY['sessions','expiresAt'], ARRAY['sessions','pending'], ARRAY['sessions','challenge'],
    ARRAY['passkeys','id'], ARRAY['passkeys','userId'], ARRAY['passkeys','credentialId'], ARRAY['passkeys','publicKey'], ARRAY['passkeys','counter'], ARRAY['passkeys','transports'], ARRAY['passkeys','name'], ARRAY['passkeys','lastUsedAt'], ARRAY['passkeys','createdAt'],
    ARRAY['recovery_codes','id'], ARRAY['recovery_codes','userId'], ARRAY['recovery_codes','codeHash'], ARRAY['recovery_codes','usedAt'], ARRAY['recovery_codes','createdAt'],
    ARRAY['app_settings','key'], ARRAY['app_settings','value'], ARRAY['app_settings','encrypted'], ARRAY['app_settings','updatedAt'],
    ARRAY['workspaces','id'], ARRAY['workspaces','name'], ARRAY['workspaces','slug'], ARRAY['workspaces','timezone'], ARRAY['workspaces','createdAt'], ARRAY['workspaces','updatedAt'],
    ARRAY['mcp_api_keys','resourceScope'], ARRAY['mcp_api_keys','id'], ARRAY['mcp_api_keys','workspaceId'], ARRAY['mcp_api_keys','createdById'], ARRAY['mcp_api_keys','name'], ARRAY['mcp_api_keys','tokenHash'], ARRAY['mcp_api_keys','tokenPrefix'], ARRAY['mcp_api_keys','readFeatures'], ARRAY['mcp_api_keys','writeFeatures'], ARRAY['mcp_api_keys','expiresAt'], ARRAY['mcp_api_keys','revokedAt'], ARRAY['mcp_api_keys','createdAt'], ARRAY['mcp_api_keys','lastUsedAt'],
    ARRAY['memberships','id'], ARRAY['memberships','userId'], ARRAY['memberships','workspaceId'], ARRAY['memberships','role'],
    ARRAY['social_accounts','id'], ARRAY['social_accounts','workspaceId'], ARRAY['social_accounts','provider'], ARRAY['social_accounts','providerUserId'], ARRAY['social_accounts','name'], ARRAY['social_accounts','pictureUrl'], ARRAY['social_accounts','accessToken'], ARRAY['social_accounts','refreshToken'], ARRAY['social_accounts','tokenExpiresAt'], ARRAY['social_accounts','scopes'], ARRAY['social_accounts','invalidatedAt'], ARRAY['social_accounts','invalidReason'], ARRAY['social_accounts','createdAt'], ARRAY['social_accounts','updatedAt'],
    ARRAY['targets','id'], ARRAY['targets','workspaceId'], ARRAY['targets','socialAccountId'], ARRAY['targets','type'], ARRAY['targets','providerId'], ARRAY['targets','name'], ARRAY['targets','pictureUrl'], ARRAY['targets','accessToken'], ARRAY['targets','enabled'], ARRAY['targets','canPublish'], ARRAY['targets','createdAt'], ARRAY['targets','updatedAt'],
    ARRAY['page_insights','id'], ARRAY['page_insights','targetId'], ARRAY['page_insights','metric'], ARRAY['page_insights','period'], ARRAY['page_insights','endTime'], ARRAY['page_insights','value'], ARRAY['page_insights','numeric'], ARRAY['page_insights','fetchedAt'],
    ARRAY['posts','id'], ARRAY['posts','workspaceId'], ARRAY['posts','authorId'], ARRAY['posts','message'], ARRAY['posts','firstComment'], ARRAY['posts','status'], ARRAY['posts','scheduledAt'], ARRAY['posts','publishedAt'], ARRAY['posts','createdAt'], ARRAY['posts','updatedAt'],
    ARRAY['post_targets','id'], ARRAY['post_targets','postId'], ARRAY['post_targets','targetId'], ARRAY['post_targets','status'], ARRAY['post_targets','remotePostId'], ARRAY['post_targets','remoteUrl'], ARRAY['post_targets','firstCommentId'], ARRAY['post_targets','firstCommentAt'], ARRAY['post_targets','firstCommentError'], ARRAY['post_targets','publishedAt'], ARRAY['post_targets','updatedAt'],
    ARRAY['post_comments','id'], ARRAY['post_comments','postTargetId'], ARRAY['post_comments','remoteId'], ARRAY['post_comments','parentRemoteId'], ARRAY['post_comments','message'], ARRAY['post_comments','fromName'], ARRAY['post_comments','fromId'], ARRAY['post_comments','likeCount'], ARRAY['post_comments','replyCount'], ARRAY['post_comments','isHidden'], ARRAY['post_comments','createdTime'], ARRAY['post_comments','fetchedAt'], ARRAY['post_comments','firstSeenAt'], ARRAY['post_comments','resolvedAt'], ARRAY['post_comments','assigneeId'], ARRAY['post_comments','sentById'], ARRAY['post_comments','sentiment'],
    ARRAY['conversations','id'], ARRAY['conversations','targetId'], ARRAY['conversations','remoteId'], ARRAY['conversations','snippet'], ARRAY['conversations','unreadCount'], ARRAY['conversations','messageCount'], ARRAY['conversations','participants'], ARRAY['conversations','updatedTime'], ARRAY['conversations','fetchedAt'], ARRAY['conversations','resolvedAt'], ARRAY['conversations','assigneeId'],
    ARRAY['conversation_messages','id'], ARRAY['conversation_messages','conversationId'], ARRAY['conversation_messages','remoteId'], ARRAY['conversation_messages','fromName'], ARRAY['conversation_messages','fromId'], ARRAY['conversation_messages','message'], ARRAY['conversation_messages','createdTime'], ARRAY['conversation_messages','firstSeenAt'], ARRAY['conversation_messages','sentById'],
    ARRAY['ad_accounts','id'], ARRAY['ad_accounts','workspaceId'], ARRAY['ad_accounts','socialAccountId'], ARRAY['ad_accounts','actId'], ARRAY['ad_accounts','name'], ARRAY['ad_accounts','currency'], ARRAY['ad_accounts','accountStatus'], ARRAY['ad_accounts','enabled'], ARRAY['ad_accounts','lastSyncedAt'], ARRAY['ad_accounts','createdAt'], ARRAY['ad_accounts','updatedAt'],
    ARRAY['ad_insights','id'], ARRAY['ad_insights','adAccountId'], ARRAY['ad_insights','level'], ARRAY['ad_insights','objectId'], ARRAY['ad_insights','objectName'], ARRAY['ad_insights','date'], ARRAY['ad_insights','spend'], ARRAY['ad_insights','impressions'], ARRAY['ad_insights','clicks'], ARRAY['ad_insights','reach'], ARRAY['ad_insights','cpc'], ARRAY['ad_insights','cpm'], ARRAY['ad_insights','cpp'], ARRAY['ad_insights','ctr'], ARRAY['ad_insights','frequency'], ARRAY['ad_insights','actions'], ARRAY['ad_insights','fields'], ARRAY['ad_insights','fetchedAt']
    ,ARRAY['rebuild_job_leases','name'], ARRAY['rebuild_job_leases','owner'], ARRAY['rebuild_job_leases','token'], ARRAY['rebuild_job_leases','leaseExpiresAt'], ARRAY['rebuild_job_leases','updatedAt']
    ,ARRAY['rebuild_sync_runs','id'], ARRAY['rebuild_sync_runs','job'], ARRAY['rebuild_sync_runs','owner'], ARRAY['rebuild_sync_runs','startedAt'], ARRAY['rebuild_sync_runs','finishedAt'], ARRAY['rebuild_sync_runs','outcome'], ARRAY['rebuild_sync_runs','attempts'], ARRAY['rebuild_sync_runs','summary'], ARRAY['rebuild_sync_runs','error']
    ,ARRAY['rebuild_inbox_deletions','id'], ARRAY['rebuild_inbox_deletions','workspaceId'], ARRAY['rebuild_inbox_deletions','targetId'], ARRAY['rebuild_inbox_deletions','provider'], ARRAY['rebuild_inbox_deletions','remoteId'], ARRAY['rebuild_inbox_deletions','localItemId'], ARRAY['rebuild_inbox_deletions','localAliases'], ARRAY['rebuild_inbox_deletions','suppressedRemoteIds'], ARRAY['rebuild_inbox_deletions','actorId'], ARRAY['rebuild_inbox_deletions','state'], ARRAY['rebuild_inbox_deletions','reason'], ARRAY['rebuild_inbox_deletions','createdAt'], ARRAY['rebuild_inbox_deletions','updatedAt'], ARRAY['rebuild_inbox_deletions','remoteConfirmedAt'], ARRAY['rebuild_inbox_deletions','completedAt']
    ,ARRAY['rebuild_post_deletions','id'], ARRAY['rebuild_post_deletions','workspaceId'], ARRAY['rebuild_post_deletions','targetId'], ARRAY['rebuild_post_deletions','provider'], ARRAY['rebuild_post_deletions','remoteId'], ARRAY['rebuild_post_deletions','actorId'], ARRAY['rebuild_post_deletions','localPostIds'], ARRAY['rebuild_post_deletions','localPostTargetIds'], ARRAY['rebuild_post_deletions','state'], ARRAY['rebuild_post_deletions','reason'], ARRAY['rebuild_post_deletions','createdAt'], ARRAY['rebuild_post_deletions','updatedAt'], ARRAY['rebuild_post_deletions','remoteConfirmedAt'], ARRAY['rebuild_post_deletions','completedAt']
    ,ARRAY['rebuild_publication_attempts','id'], ARRAY['rebuild_publication_attempts','workspaceId'], ARRAY['rebuild_publication_attempts','postId'], ARRAY['rebuild_publication_attempts','postTargetId'], ARRAY['rebuild_publication_attempts','targetId'], ARRAY['rebuild_publication_attempts','provider'], ARRAY['rebuild_publication_attempts','actorId'], ARRAY['rebuild_publication_attempts','state'], ARRAY['rebuild_publication_attempts','reason'], ARRAY['rebuild_publication_attempts','remotePostId'], ARRAY['rebuild_publication_attempts','remoteUrl'], ARRAY['rebuild_publication_attempts','receiptAt'], ARRAY['rebuild_publication_attempts','projectedAt'], ARRAY['rebuild_publication_attempts','attestedAt'], ARRAY['rebuild_publication_attempts','attestedBy'], ARRAY['rebuild_publication_attempts','createdAt'], ARRAY['rebuild_publication_attempts','updatedAt']
    ,ARRAY['rebuild_facebook_media_steps','id'], ARRAY['rebuild_facebook_media_steps','workspaceId'], ARRAY['rebuild_facebook_media_steps','operationId'], ARRAY['rebuild_facebook_media_steps','postId'], ARRAY['rebuild_facebook_media_steps','postTargetId'], ARRAY['rebuild_facebook_media_steps','targetId'], ARRAY['rebuild_facebook_media_steps','actorId'], ARRAY['rebuild_facebook_media_steps','remoteTargetId'], ARRAY['rebuild_facebook_media_steps','phase'], ARRAY['rebuild_facebook_media_steps','ordinal'], ARRAY['rebuild_facebook_media_steps','state'], ARRAY['rebuild_facebook_media_steps','remoteId'], ARRAY['rebuild_facebook_media_steps','receiptAt'], ARRAY['rebuild_facebook_media_steps','rejectedAt'], ARRAY['rebuild_facebook_media_steps','createdAt'], ARRAY['rebuild_facebook_media_steps','updatedAt']
    ,ARRAY['rebuild_facebook_media_deletions','id'], ARRAY['rebuild_facebook_media_deletions','workspaceId'], ARRAY['rebuild_facebook_media_deletions','mediaStepId'], ARRAY['rebuild_facebook_media_deletions','operationId'], ARRAY['rebuild_facebook_media_deletions','postId'], ARRAY['rebuild_facebook_media_deletions','postTargetId'], ARRAY['rebuild_facebook_media_deletions','targetId'], ARRAY['rebuild_facebook_media_deletions','remoteTargetId'], ARRAY['rebuild_facebook_media_deletions','remotePhotoId'], ARRAY['rebuild_facebook_media_deletions','actorId'], ARRAY['rebuild_facebook_media_deletions','state'], ARRAY['rebuild_facebook_media_deletions','receiptAt'], ARRAY['rebuild_facebook_media_deletions','createdAt'], ARRAY['rebuild_facebook_media_deletions','updatedAt']
    ,ARRAY['ads_management_operations','id'], ARRAY['ads_management_operations','workspaceId'], ARRAY['ads_management_operations','adAccountId'], ARRAY['ads_management_operations','actorId'], ARRAY['ads_management_operations','requestId'], ARRAY['ads_management_operations','requestHash'], ARRAY['ads_management_operations','operationType'], ARRAY['ads_management_operations','objectType'], ARRAY['ads_management_operations','objectId'], ARRAY['ads_management_operations','params'], ARRAY['ads_management_operations','status'], ARRAY['ads_management_operations','remoteId'], ARRAY['ads_management_operations','failureCode'], ARRAY['ads_management_operations','createdAt'], ARRAY['ads_management_operations','updatedAt'], ARRAY['ads_management_operations','completedAt'], ARRAY['ads_management_operations','resolvedBy'], ARRAY['ads_management_operations','resolvedAt'], ARRAY['ads_management_operations','resolutionNote'], ARRAY['workspace_data_purges','workspaceId'], ARRAY['workspace_data_purges','status'], ARRAY['workspace_data_purges','completedAt'], ARRAY['tasks','id'], ARRAY['tasks','workspaceId'], ARRAY['task_comments','id'], ARRAY['task_comments','taskId'], ARRAY['task_comments','workspaceId'], ARRAY['task_comments','authorId'], ARRAY['task_comments','body'], ARRAY['task_comments','createdAt']
    ,ARRAY['rebuild_notifications','id'], ARRAY['rebuild_notifications','eventId'], ARRAY['rebuild_notifications','workspaceId'], ARRAY['rebuild_notifications','userId'], ARRAY['rebuild_notifications','kind'], ARRAY['rebuild_notifications','postId'], ARRAY['rebuild_notifications','noteId'], ARRAY['rebuild_notifications','targetId'], ARRAY['rebuild_notifications','labelId'], ARRAY['rebuild_notifications','createdAt'], ARRAY['rebuild_notifications','updatedAt'], ARRAY['rebuild_notifications','readAt'], ARRAY['rebuild_notifications','emailSentAt'], ARRAY['rebuild_notifications','lastAttemptAt'], ARRAY['rebuild_notifications','emailState'], ARRAY['rebuild_notifications','attempt'], ARRAY['rebuild_notifications','nextAt'], ARRAY['rebuild_notifications','claimToken'], ARRAY['rebuild_notifications','claimUntil'], ARRAY['rebuild_notifications','safeReason']
    ,ARRAY['rebuild_facebook_media_resolutions','id'], ARRAY['rebuild_facebook_media_resolutions','workspaceId'], ARRAY['rebuild_facebook_media_resolutions','operationId'], ARRAY['rebuild_facebook_media_resolutions','mediaStepId'], ARRAY['rebuild_facebook_media_resolutions','deletionId'], ARRAY['rebuild_facebook_media_resolutions','postId'], ARRAY['rebuild_facebook_media_resolutions','postTargetId'], ARRAY['rebuild_facebook_media_resolutions','targetId'], ARRAY['rebuild_facebook_media_resolutions','remoteTargetId'], ARRAY['rebuild_facebook_media_resolutions','publicationActorId'], ARRAY['rebuild_facebook_media_resolutions','eventActorId'], ARRAY['rebuild_facebook_media_resolutions','phase'], ARRAY['rebuild_facebook_media_resolutions','ordinal'], ARRAY['rebuild_facebook_media_resolutions','source'], ARRAY['rebuild_facebook_media_resolutions','outcome'], ARRAY['rebuild_facebook_media_resolutions','remoteId'], ARRAY['rebuild_facebook_media_resolutions','createdAt'], ARRAY['rebuild_facebook_media_steps','attestedAt'], ARRAY['rebuild_facebook_media_steps','attestedBy'], ARRAY['rebuild_facebook_media_deletions','attestedAt'], ARRAY['rebuild_facebook_media_deletions','attestedBy']
    ,ARRAY['report_runs','id'], ARRAY['report_runs','workspaceId'], ARRAY['report_runs','scheduleId'], ARRAY['report_runs','targetId'], ARRAY['report_runs','kind'], ARRAY['report_runs','idempotencyKey'], ARRAY['report_runs','claimToken'], ARRAY['report_runs','requestHash'], ARRAY['report_runs','periodStart'], ARRAY['report_runs','periodEnd'], ARRAY['report_runs','status'], ARRAY['report_runs','leaseUntil'], ARRAY['report_runs','startedAt'], ARRAY['report_runs','finishedAt'], ARRAY['report_runs','rowCount'], ARRAY['report_runs','truncated'], ARRAY['report_runs','failureReason'], ARRAY['report_runs','deliveries'], ARRAY['report_runs','requestedById'], ARRAY['report_runs','output'], ARRAY['report_runs','outputExpiresAt'], ARRAY['report_runs','createdAt']
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=item[1] AND column_name=item[2]
    ) THEN RAISE EXCEPTION 'rebuild mapping missing %.%', item[1], item[2]; END IF;
  END LOOP;
  IF NOT ARRAY['owner','admin','editor','contributor','viewer','client']::text[] <@
    (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
     FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname='WorkspaceRole') THEN
    RAISE EXCEPTION 'WorkspaceRole enum does not contain all rebuild values';
  END IF;
  IF NOT ARRAY['page','group','instagram','bluesky','mastodon','linkedin','threads','x','pinterest','telegram','youtube','tiktok']::text[] <@
    (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
     FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname='TargetType') THEN
    RAISE EXCEPTION 'TargetType enum does not contain all rebuild values';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'report_runs'
      AND t.tgname = 'rebuild_workspace_purge_write_gate'
      AND t.tgfoid = to_regprocedure('public.rebuild_reject_purging_workspace_write()')
      AND t.tgenabled IN ('O', 'A') AND NOT t.tgisinternal
  ) THEN RAISE EXCEPTION 'report_runs purge write trigger is missing or disabled'; END IF;
END $$;
SQL

count_rows() {
  local database_url="$1"
  # Emit one sorted table=count record per public base table. Only aggregate
  # counts leave PostgreSQL; table identifiers are quoted via format().
  psql "$database_url" -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT format('%I=%s', c.relname, (xpath('/row/n/text()', query_to_xml(
  format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname),
  false, true, ''
)))[1]::text)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;
SQL
}
before="$(count_rows "$source_url")"
echo "staging row counts: $before"

# Rehearse a backup and restore independently of the supplied staging dump.
backup_file="$(mktemp "${TMPDIR:-/tmp}/cutover-rehearsal.XXXXXX")"
trap 'rm -f "$backup_file"; cleanup' EXIT
pg_dump --format=custom --no-owner --no-acl --file "$backup_file" "$source_url"
psql "$CUTOVER_ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$restore_db\""
created_restore=1
restore_url="$(db_url "$restore_db")"
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$restore_url" "$backup_file"
after="$(count_rows "$restore_url")"
[ "$before" = "$after" ] || fail "backup/restore row counts changed: before={$before}; after={$after}"
echo "backup/restore counts match: $after"
echo "CUTOVER_REHEARSAL_OK (scratch databases are removed on exit)"
