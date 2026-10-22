#!/usr/bin/env bash
# Staging migration rehearsal (lane 47): apply the single checksum-pinned
# baseline migration to an empty local scratch database, verify the mapped
# schema/constraints, then prove a backup/restore preserves it. This script
# never connects to production. The pre-cutover dump flow is retired: the
# database history is one baseline, and production marks it applied without
# re-running it (see prod-deploy.sh resolve handling).
set -euo pipefail

fail() { echo "cutover rehearsal: $*" >&2; exit 1; }

: "${CUTOVER_ADMIN_URL:?Set CUTOVER_ADMIN_URL to a local PostgreSQL admin URL ending in /postgres}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"   # rebuild/ (migrations and schema live here)
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
verify_migration 20261103000000_baseline 8abd5224f753f0cb845f9bd748e12e8db3cb7dbb4f1348c714e1d62231e0f8dd

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

# The scratch database must be empty: the baseline creates the whole schema.
[ "$(psql "$source_url" -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")" = 0 ] \
  || fail "scratch database is not empty; refusing to apply the baseline"
# No single-transaction flag: the baseline contains ALTER TYPE ... ADD VALUE,
# which PostgreSQL forbids inside a transaction block. ON_ERROR_STOP still
# aborts on the first failure, and the scratch database is removed on exit.
psql "$source_url" -q -v ON_ERROR_STOP=1 -f "$migration_dir/20261103000000_baseline/migration.sql"
psql "$source_url" -q -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DO $$
DECLARE
  token text := replace(gen_random_uuid()::text, '-', '');
  workspace_id text := 'cutover_comment_delay_' || replace(gen_random_uuid()::text, '-', '');
  user_id text := 'cutover_comment_delay_user_' || replace(gen_random_uuid()::text, '-', '');
  post_id text := 'cutover_comment_delay_post_' || replace(gen_random_uuid()::text, '-', '');
  template_default integer;
  version_default integer;
  rejected integer := 0;
BEGIN
  INSERT INTO workspaces (id,name,slug,timezone,"createdAt","updatedAt") VALUES (workspace_id,'Comment delay rehearsal',workspace_id,'UTC',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
  INSERT INTO users (id,email,name,"passwordHash","createdAt","updatedAt") VALUES (user_id,token || '@example.test','Comment delay rehearsal','unusable',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
  INSERT INTO posts (id,"workspaceId","authorId",message,format,timezone,"createdAt","updatedAt") VALUES (post_id,workspace_id,user_id,'','post','UTC',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
  INSERT INTO post_templates (id,"workspaceId",name,body,"createdAt","updatedAt") VALUES (token || '_template',workspace_id,token,'',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
  SELECT "firstCommentDelayMinutes" INTO template_default FROM post_templates WHERE id=token || '_template';
  INSERT INTO post_versions (id,"postId",message,format,timezone,"createdAt") VALUES (token || '_version',post_id,'','post','UTC',CURRENT_TIMESTAMP);
  SELECT "firstCommentDelayMinutes" INTO version_default FROM post_versions WHERE id=token || '_version';
  IF template_default <> 0 OR version_default <> 0 THEN RAISE EXCEPTION 'first-comment delay defaults must be zero'; END IF;

  BEGIN
    UPDATE post_templates SET "firstCommentDelayMinutes"=-1 WHERE id=token || '_template';
    RAISE EXCEPTION 'negative template delay was accepted';
  EXCEPTION WHEN check_violation THEN rejected := rejected + 1;
  END;
  BEGIN
    UPDATE post_versions SET "firstCommentDelayMinutes"=-1 WHERE id=token || '_version';
    RAISE EXCEPTION 'negative version delay was accepted';
  EXCEPTION WHEN check_violation THEN rejected := rejected + 1;
  END;
  IF rejected <> 2 THEN RAISE EXCEPTION 'expected two negative first-comment delays to be rejected, got %', rejected; END IF;
  RAISE NOTICE 'template and version first-comment delay defaults and checks verified';
END $$;
ROLLBACK;
SQL
psql "$source_url" -q -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DO $$
DECLARE
  workspace_id text;
  token text := replace(gen_random_uuid()::text, '-', '');
  rejected integer := 0;
BEGIN
  workspace_id := token || '_workspace_' || txid_current()::text;
  INSERT INTO workspaces (id, name, slug, timezone, "createdAt", "updatedAt")
  VALUES (workspace_id, 'Cutover submission rehearsal', workspace_id, 'UTC', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
  INSERT INTO rebuild_publication_attempts
    (id, "workspaceId", "postId", "postTargetId", "targetId", provider, "actorId", state, reason, "remotePostId", "remoteUrl", "receiptAt")
  VALUES (token || 'valid', workspace_id, token || 'post', token || 'target-link', token || 'target', 'facebook', token || 'actor', 'submitted', 'provider_submission', token || 'remote', 'https://provider.invalid/post', CURRENT_TIMESTAMP);

  -- Each malformed shape must fail the database CHECK inside its own subtransaction.
  BEGIN
    INSERT INTO rebuild_publication_attempts
      (id, "workspaceId", "postId", "postTargetId", "targetId", provider, "actorId", state, reason, "remotePostId", "receiptAt")
    VALUES (token || 'badreason', workspace_id, token || 'p1', token || 't1', token || 'x1', 'facebook', token || 'actor', 'submitted', 'provider_receipt', token || 'r1', CURRENT_TIMESTAMP);
    RAISE EXCEPTION 'submitted without provider_submission reason was accepted';
  EXCEPTION WHEN check_violation THEN rejected := rejected + 1;
  END;
  BEGIN
    INSERT INTO rebuild_publication_attempts
      (id, "workspaceId", "postId", "postTargetId", "targetId", provider, "actorId", state, reason, "receiptAt")
    VALUES (token || 'badremote', workspace_id, token || 'p2', token || 't2', token || 'x2', 'facebook', token || 'actor', 'submitted', 'provider_submission', CURRENT_TIMESTAMP);
    RAISE EXCEPTION 'submitted without remotePostId was accepted';
  EXCEPTION WHEN check_violation THEN rejected := rejected + 1;
  END;
  BEGIN
    INSERT INTO rebuild_publication_attempts
      (id, "workspaceId", "postId", "postTargetId", "targetId", provider, "actorId", state, reason, "remotePostId")
    VALUES (token || 'badreceipt', workspace_id, token || 'p3', token || 't3', token || 'x3', 'facebook', token || 'actor', 'submitted', 'provider_submission', token || 'r3');
    RAISE EXCEPTION 'submitted without receiptAt was accepted';
  EXCEPTION WHEN check_violation THEN rejected := rejected + 1;
  END;
  BEGIN
    INSERT INTO rebuild_publication_attempts
      (id, "workspaceId", "postId", "postTargetId", "targetId", provider, "actorId", state, reason, "remotePostId", "receiptAt", "projectedAt")
    VALUES (token || 'badprojected', workspace_id, token || 'p4', token || 't4', token || 'x4', 'facebook', token || 'actor', 'submitted', 'provider_submission', token || 'r4', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    RAISE EXCEPTION 'submitted with projectedAt was accepted';
  EXCEPTION WHEN check_violation THEN rejected := rejected + 1;
  END;
  BEGIN
    INSERT INTO rebuild_publication_attempts
      (id, "workspaceId", "postId", "postTargetId", "targetId", provider, "actorId", state, reason, "remotePostId", "receiptAt", "attestedAt", "attestedBy")
    VALUES (token || 'badattest', workspace_id, token || 'p5', token || 't5', token || 'x5', 'facebook', token || 'actor', 'submitted', 'provider_submission', token || 'r5', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, token || 'attestor');
    RAISE EXCEPTION 'submitted with attestation fields was accepted';
  EXCEPTION WHEN check_violation THEN rejected := rejected + 1;
  END;
  IF rejected <> 5 THEN RAISE EXCEPTION 'expected five malformed submitted shapes to be rejected, got %', rejected; END IF;
  RAISE NOTICE 'submitted state accepted; five malformed shapes rejected';
END $$;
ROLLBACK;
SQL
echo "baseline migration applied to local scratch database"

# Required tables/columns are taken from rebuild/prisma/schema.prisma and
# reviewed raw-SQL journal queries. This verifies the client view against the
# baseline-created layout. The omitted columns and tables remain untouched.
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
    ARRAY['posts','id'], ARRAY['posts','workspaceId'], ARRAY['posts','authorId'], ARRAY['posts','message'], ARRAY['posts','firstComment'], ARRAY['posts','firstCommentDelayMinutes'], ARRAY['posts','status'], ARRAY['posts','scheduledAt'], ARRAY['posts','publishedAt'], ARRAY['posts','createdAt'], ARRAY['posts','updatedAt'],
    ARRAY['post_templates','firstCommentDelayMinutes'], ARRAY['post_targets','formatId'], ARRAY['post_versions','destinationFormats'], ARRAY['post_versions','firstCommentDelayMinutes'],
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
    ,ARRAY['rebuild_facebook_native_journal','operationId'], ARRAY['rebuild_facebook_native_journal','workspaceId'], ARRAY['rebuild_facebook_native_journal','postId'], ARRAY['rebuild_facebook_native_journal','postTargetId'], ARRAY['rebuild_facebook_native_journal','targetId'], ARRAY['rebuild_facebook_native_journal','actorId'], ARRAY['rebuild_facebook_native_journal','remoteTargetId'], ARRAY['rebuild_facebook_native_journal','format'], ARRAY['rebuild_facebook_native_journal','sourceFormatId'], ARRAY['rebuild_facebook_native_journal','payloadHash'], ARRAY['rebuild_facebook_native_journal','ownerToken'], ARRAY['rebuild_facebook_native_journal','revision'], ARRAY['rebuild_facebook_native_journal','state'], ARRAY['rebuild_facebook_native_journal','knownIds'], ARRAY['rebuild_facebook_native_journal','steps'], ARRAY['rebuild_facebook_native_journal','remoteId'], ARRAY['rebuild_facebook_native_journal','conflicted'], ARRAY['rebuild_facebook_native_journal','createdAt'], ARRAY['rebuild_facebook_native_journal','updatedAt']
    ,ARRAY['rebuild_facebook_native_status_proofs','id'], ARRAY['rebuild_facebook_native_status_proofs','workspaceId'], ARRAY['rebuild_facebook_native_status_proofs','operationId'], ARRAY['rebuild_facebook_native_status_proofs','observedRevision'], ARRAY['rebuild_facebook_native_status_proofs','appliedRevision'], ARRAY['rebuild_facebook_native_status_proofs','payloadHash'], ARRAY['rebuild_facebook_native_status_proofs','format'], ARRAY['rebuild_facebook_native_status_proofs','remoteTargetId'], ARRAY['rebuild_facebook_native_status_proofs','remoteId'], ARRAY['rebuild_facebook_native_status_proofs','actorId'], ARRAY['rebuild_facebook_native_status_proofs','outcome'], ARRAY['rebuild_facebook_native_status_proofs','detail'], ARRAY['rebuild_facebook_native_status_proofs','observedAt'], ARRAY['rebuild_facebook_native_status_proofs','accepted'], ARRAY['rebuild_facebook_native_status_proofs','createdAt']
    ,ARRAY['wordpress_recipe_sources','id'], ARRAY['wordpress_recipe_sources','workspaceId'], ARRAY['wordpress_recipe_sources','name'], ARRAY['wordpress_recipe_sources','siteUrl'], ARRAY['wordpress_recipe_sources','enabled'], ARRAY['wordpress_recipe_sources','allTargets'], ARRAY['wordpress_recipe_sources','targetIds'], ARRAY['wordpress_recipe_sources','config'], ARRAY['wordpress_recipe_sources','lastRunAt'], ARRAY['wordpress_recipe_sources','lastError'], ARRAY['wordpress_recipe_sources','lastSummary'], ARRAY['wordpress_recipe_sources','createdAt'], ARRAY['wordpress_recipe_sources','updatedAt']
    ,ARRAY['wordpress_recipe_plans','id'], ARRAY['wordpress_recipe_plans','workspaceId'], ARRAY['wordpress_recipe_plans','sourceId'], ARRAY['wordpress_recipe_plans','targetId'], ARRAY['wordpress_recipe_plans','wpPostId'], ARRAY['wordpress_recipe_plans','slotAt'], ARRAY['wordpress_recipe_plans','state'], ARRAY['wordpress_recipe_plans','postId'], ARRAY['wordpress_recipe_plans','title'], ARRAY['wordpress_recipe_plans','permalink'], ARRAY['wordpress_recipe_plans','reason'], ARRAY['wordpress_recipe_plans','skipped'], ARRAY['wordpress_recipe_plans','claimedAt'], ARRAY['wordpress_recipe_plans','createdAt'], ARRAY['wordpress_recipe_plans','updatedAt']
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
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace
    WHERE ns.nspname = 'public' AND child.relname = 'rebuild_facebook_native_journal'
      AND c.conname = 'rebuild_facebook_native_journal_workspaceId_fkey'
      AND c.contype = 'f' AND c.confrelid = 'public.workspaces'::regclass
      AND c.confdeltype = 'c' AND c.confupdtype = 'c'
      AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ordinality) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) = ARRAY['workspaceId']::text[]
      AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality) FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ordinality) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) = ARRAY['id']::text[]
  ) THEN RAISE EXCEPTION 'Facebook native journal workspace cascade FK is missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace
    WHERE ns.nspname = 'public' AND child.relname = 'rebuild_facebook_native_journal'
      AND c.conname = 'rebuild_facebook_native_journal_parent_fkey'
      AND c.contype = 'f' AND c.confrelid = 'public.rebuild_publication_attempts'::regclass
      AND c.confdeltype = 'c' AND c.confupdtype = 'c'
      AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ordinality) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) = ARRAY['workspaceId','operationId']::text[]
      AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality) FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ordinality) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) = ARRAY['workspaceId','id']::text[]
  ) THEN RAISE EXCEPTION 'Facebook native journal composite parent cascade FK is missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'rebuild_facebook_native_journal'
      AND t.tgname = 'rebuild_workspace_purge_write_gate'
      AND t.tgfoid = to_regprocedure('public.rebuild_reject_purging_workspace_write()')
      AND t.tgenabled IN ('O', 'A') AND NOT t.tgisinternal
  ) THEN RAISE EXCEPTION 'Facebook native journal purge write trigger is missing or disabled'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'rebuild_facebook_native_journal'
      AND t.tgname = 'rebuild_facebook_native_journal_guard_trigger'
      AND t.tgfoid = to_regprocedure('public.rebuild_facebook_native_journal_guard()')
      AND t.tgenabled IN ('O', 'A') AND NOT t.tgisinternal
  ) THEN RAISE EXCEPTION 'Facebook native journal integrity trigger is missing or disabled'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'rebuild_publication_attempts'
      AND t.tgname = 'rebuild_publication_attempts_native_binding_guard_trigger'
      AND t.tgfoid = to_regprocedure('public.rebuild_publication_attempts_native_binding_guard()')
      AND t.tgenabled IN ('O', 'A') AND NOT t.tgisinternal
  ) THEN RAISE EXCEPTION 'Facebook native parent binding trigger is missing or disabled'; END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'rebuild_facebook_native_status_proofs') <> 15 THEN
    RAISE EXCEPTION 'Facebook native status proof table must have exactly 15 columns';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
      WHERE conrelid = 'public.rebuild_facebook_native_status_proofs'::regclass AND contype = 'f') <> 3 OR
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.rebuild_facebook_native_status_proofs'::regclass AND conname = 'rebuild_facebook_native_status_proofs_workspaceId_fkey' AND confrelid = 'public.workspaces'::regclass AND confdeltype = 'c') OR
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.rebuild_facebook_native_status_proofs'::regclass AND conname = 'rebuild_facebook_native_status_proofs_parent_fkey' AND confrelid = 'public.rebuild_publication_attempts'::regclass AND confdeltype = 'c') OR
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.rebuild_facebook_native_status_proofs'::regclass AND conname = 'rebuild_facebook_native_status_proofs_operation_fkey' AND confrelid = 'public.rebuild_facebook_native_journal'::regclass AND confdeltype = 'c') THEN
    RAISE EXCEPTION 'Facebook native status proof table must have three cascading tenant/parent/operation FKs';
  END IF;
  IF to_regprocedure('public.rebuild_facebook_native_status_proofs_guard()') IS NULL OR
     NOT EXISTS (
       SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'rebuild_facebook_native_status_proofs'
         AND t.tgname = 'rebuild_facebook_native_status_proofs_guard_trigger'
         AND t.tgfoid = to_regprocedure('public.rebuild_facebook_native_status_proofs_guard()')
         AND t.tgenabled IN ('O', 'A') AND NOT t.tgisinternal
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'rebuild_facebook_native_status_proofs'
         AND t.tgname = 'rebuild_workspace_purge_write_gate'
         AND t.tgfoid = to_regprocedure('public.rebuild_reject_purging_workspace_write()')
         AND t.tgenabled IN ('O', 'A') AND NOT t.tgisinternal
     ) THEN RAISE EXCEPTION 'Facebook native status proof integrity or purge trigger is missing or disabled'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
    WHERE i.indrelid = 'public.rebuild_facebook_native_status_proofs'::regclass
      AND idx.relname = 'rebuild_fb_native_proofs_accepted_revision_key'
      AND i.indisunique AND pg_get_expr(i.indpred, i.indrelid) = 'accepted'
  ) THEN RAISE EXCEPTION 'Facebook native status proof accepted-revision unique index is missing'; END IF;
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

# Rehearse a backup and restore of the migrated scratch database.
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