import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE_NAME, BASELINE_SHA256, baselineBlock } from './baseline-block';

const script = 'scripts/cutover-rehearsal.sh';

describe('cutover rehearsal safety gates', () => {
  it('pins the checksummed baseline and applies it before mapped-schema checks', () => {
    const source = readFileSync(script, 'utf8');
    expect(source).toContain(`verify_migration ${BASELINE_NAME} ${BASELINE_SHA256}`);
    const apply = source.indexOf(`migration_dir/${BASELINE_NAME}/migration.sql`);
    expect(apply).toBeGreaterThan(-1);
    expect(apply).toBeLessThan(source.indexOf('Required tables/columns are taken'));
    expect(source).not.toMatch(/verify_migration 202[0-9]{12}_/);
    expect(source).not.toContain('CUTOVER_APPROVED_MIGRATION_SET');
    expect(source).not.toContain('CUTOVER_STAGING_DUMP');
    expect(source).not.toContain('CUTOVER_DUMP_SANITIZED');
  });

  it('applies without a wrapping transaction because of enum additions', () => {
    const source = readFileSync(script, 'utf8');
    expect(source).toContain('ALTER TYPE ... ADD VALUE');
    expect(source).not.toMatch(/psql "\$source_url" -q -v ON_ERROR_STOP=1 -1 -f/);
    expect(source).not.toContain('--single-transaction');
  });

  it('pins report runs, the purge gate and sharing expiry columns', () => {
    const source = readFileSync(script, 'utf8');
    expect(source).toContain("t.tgfoid = to_regprocedure('public.rebuild_reject_purging_workspace_write()')");
    expect(source).toContain("t.tgenabled IN ('O', 'A')");
    for (const column of ['id', 'workspaceId', 'scheduleId', 'targetId', 'kind', 'idempotencyKey', 'claimToken', 'requestHash', 'periodStart', 'periodEnd', 'status', 'leaseUntil', 'startedAt', 'finishedAt', 'rowCount', 'truncated', 'failureReason', 'deliveries', 'requestedById', 'output', 'outputExpiresAt', 'createdAt']) {
      expect(source).toContain(`ARRAY['report_runs','${column}']`);
    }
    expect(source).toContain("ARRAY['share_links','expiresAt']");
  });
  it('compares counts for every public base table and detects table-set drift', () => {
    const source = readFileSync(script, 'utf8');
    expect(source).toContain("WHERE n.nspname = 'public' AND c.relkind = 'r'");
    expect(source).toContain("ORDER BY c.relname");
    expect(source).toContain('backup/restore row counts changed');
    expect(source).not.toMatch(/for table in users workspaces/);
    expect(source).not.toMatch(/SELECT \* FROM/);
  });

  it('fails closed for a non-loopback PostgreSQL URL before invoking database tools', () => {
    let output = '';
    try {
      execFileSync('bash', [script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          CUTOVER_ADMIN_URL: 'postgresql://user:secret@production.example:5432/postgres',
        },
      });
    } catch (error) {
      output = `${(error as { stderr?: string }).stderr ?? ''}`;
    }
    expect(output).toContain('admin URL must target loopback');
  });

  it('requires an explicit admin URL and refuses a non-empty scratch database', () => {
    let output = '';
    try {
      execFileSync('bash', [script], {
        encoding: 'utf8',
        env: { ...process.env, CUTOVER_ADMIN_URL: '' },
      });
    } catch (error) {
      output = `${(error as { stderr?: string }).stderr ?? ''}`;
    }
    expect(output).toContain('Set CUTOVER_ADMIN_URL');
    expect(readFileSync(script, 'utf8')).toContain('scratch database is not empty; refusing to apply the baseline');
  });

  it('verifies the Ads ledger, creation kinds, purge gate and task comments', () => {
    const source = readFileSync(script, 'utf8');
    const creation = baselineBlock('20261018190000_rebuild_ads_creation');
    expect(source).toContain("ARRAY['ads_management_operations','requestHash']");
    expect(creation).toContain("'campaign.create'");
    expect(creation).toContain("'adset.create'");
    const comments = baselineBlock('20261025100000_rebuild_task_comments');
    const purge = baselineBlock('20261018193000_rebuild_purge_write_gates');
    expect(comments).toContain('rebuild_reject_purging_workspace_write()');
    expect(purge).toContain('CREATE OR REPLACE FUNCTION public.rebuild_reject_purging_workspace_write()');
    expect(source).toContain("ARRAY['task_comments','workspaceId']");
  });

  it('verifies notifications, journals and foundation tables', () => {
    const source = readFileSync(script, 'utf8');
    expect(source).toContain("ARRAY['rebuild_notifications','claimUntil']");
    expect(source).toContain("ARRAY['rebuild_inbox_deletions','remoteConfirmedAt']");
    expect(source).toContain("ARRAY['rebuild_inbox_deletions','completedAt']");
    expect(source).toContain("ARRAY['rebuild_inbox_deletions','localAliases']");
    expect(source).toContain("ARRAY['rebuild_inbox_deletions','suppressedRemoteIds']");
    expect(source).toContain("ARRAY['rebuild_post_deletions','localPostIds']");
    expect(source).toContain("ARRAY['rebuild_post_deletions','localPostTargetIds']");
    expect(source).toContain("ARRAY['rebuild_publication_attempts','attestedBy']");
    expect(source).toContain("ARRAY['rebuild_publication_attempts','remotePostId']");
    for (const column of ['id', 'workspaceId', 'mediaStepId', 'operationId', 'postId', 'postTargetId', 'targetId', 'remoteTargetId', 'remotePhotoId', 'actorId', 'state', 'receiptAt', 'createdAt', 'updatedAt']) expect(source).toContain("ARRAY['rebuild_facebook_media_deletions','" + column + "']");
    for (const column of ['id', 'workspaceId', 'operationId', 'mediaStepId', 'deletionId', 'postId', 'postTargetId', 'targetId', 'remoteTargetId', 'publicationActorId', 'eventActorId', 'phase', 'ordinal', 'source', 'outcome', 'remoteId', 'createdAt']) expect(source).toContain("ARRAY['rebuild_facebook_media_resolutions','" + column + "']");
    for (const column of ['workspaceId', 'operationId', 'phase', 'ordinal', 'state', 'remoteId', 'receiptAt']) expect(source).toContain("ARRAY['rebuild_facebook_media_steps','" + column + "']");
  });

  it('maps the content-free deletion journal and guards its SQL constraints', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const migration = baselineBlock('20261016190000_rebuild_inbox_deletions');
    const model = schema.split('model RebuildInboxDeletion {')[1]?.split('\n}')[0] ?? '';

    expect(model).toContain('workspace           Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)');
    expect(model).toContain('@@unique([workspaceId, provider, targetId, remoteId])');
    expect(model).toContain('@@index([workspaceId, targetId, updatedAt])');
    expect(model).toContain('@@map("rebuild_inbox_deletions")');
    expect(model).toContain('localAliases        String[]  @default([])');
    expect(model).toContain('suppressedRemoteIds String[]  @default([])');
    expect(model).not.toMatch(/accessToken|refreshToken|message|content/i);
    expect(migration).toContain('REFERENCES "workspaces"("id") ON DELETE CASCADE');
    expect(migration).toContain('"localAliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]');
    expect(migration).toContain('"suppressedRemoteIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]');
    expect(migration).toContain('CHECK ("state" IN (\'started\', \'uncertain\', \'remote_confirmed\', \'completed\', \'rejected\'))');
    expect(migration).toContain('CHECK ("reason" IS NULL OR "reason" IN (\'transport_unconfirmed\', \'provider_rejected\', \'local_pending\'))');
    expect(migration).toContain('"state" <> \'completed\' OR ("remoteConfirmedAt" IS NOT NULL AND "completedAt" IS NOT NULL)');
    expect(migration).toContain('"state" <> \'remote_confirmed\' OR "remoteConfirmedAt" IS NOT NULL');
    expect(migration).toContain('"state" IN (\'completed\', \'remote_confirmed\') OR "completedAt" IS NULL');
    expect(migration).not.toMatch(/REFERENCES "(targets|users)"/);
  });

  it('rehearses the native Facebook journal parent and purge guards', () => {
    const source = readFileSync(script, 'utf8');
    const schema = readFileSync('prisma/schema.prisma', 'utf8');

    for (const column of ['operationId', 'workspaceId', 'postId', 'postTargetId', 'targetId', 'actorId', 'remoteTargetId', 'format', 'sourceFormatId', 'payloadHash', 'ownerToken', 'revision', 'state', 'knownIds', 'steps', 'remoteId', 'conflicted', 'createdAt', 'updatedAt']) {
      expect(source).toContain(`ARRAY['rebuild_facebook_native_journal','${column}']`);
    }
    expect(schema).not.toContain('model RebuildFacebookNativeJournal {');
    expect(source).toContain("c.conname = 'rebuild_facebook_native_journal_workspaceId_fkey'");
    expect(source).toContain("c.conname = 'rebuild_facebook_native_journal_parent_fkey'");
    expect(source).toContain("ARRAY['workspaceId','operationId']::text[]");
    expect(source).toContain("ARRAY['workspaceId','id']::text[]");
    expect(source).toContain("t.tgfoid = to_regprocedure('public.rebuild_reject_purging_workspace_write()')");
    expect(source).toContain("t.tgname = 'rebuild_workspace_purge_write_gate'");
    expect(source).toContain("t.tgname = 'rebuild_facebook_native_journal_guard_trigger'");
    expect(source).toContain("t.tgname = 'rebuild_publication_attempts_native_binding_guard_trigger'");
    expect(source).not.toContain('rebuild_facebook_native_journal_active');
  });

  it('rehearses the identity-bound native status proof ledger', () => {
    const source = readFileSync(script, 'utf8');
    const migration = baselineBlock('20261019040000_rebuild_facebook_native_status_proofs');
    const schema = readFileSync('prisma/schema.prisma', 'utf8');

    expect(source).toContain('Facebook native status proof table must have exactly 15 columns');
    expect(source).toContain('Facebook native status proof table must have three cascading tenant/parent/operation FKs');
    expect(source).toContain('Facebook native status proof integrity or purge trigger is missing or disabled');
    expect(source).toContain('Facebook native status proof accepted-revision unique index is missing');
    for (const column of ['id', 'workspaceId', 'operationId', 'observedRevision', 'appliedRevision', 'payloadHash', 'format', 'remoteTargetId', 'remoteId', 'actorId', 'outcome', 'detail', 'observedAt', 'accepted', 'createdAt']) {
      expect(source).toContain(`ARRAY['rebuild_facebook_native_status_proofs','${column}']`);
    }
    expect(migration).toContain('CREATE UNIQUE INDEX "rebuild_fb_native_proofs_accepted_revision_key"');
    expect(migration).toContain('WHERE "accepted"');
    expect(schema).not.toContain('model RebuildFacebookNativeStatusProof');
  });

  it('rehearses template and version first-comment delay constraints', () => {
    const source = readFileSync(script, 'utf8');
    const migration = baselineBlock('20261019060000_rebuild_template_comment_delay');

    expect(source).toContain("ARRAY['posts','firstCommentDelayMinutes']");
    expect(source).toContain("ARRAY['post_templates','firstCommentDelayMinutes']");
    expect(source).toContain("ARRAY['post_versions','firstCommentDelayMinutes']");
    expect(source).toContain('template_default <> 0 OR version_default <> 0');
    expect(source).toContain('negative template delay was accepted');
    expect(source).toContain('negative version delay was accepted');
    expect(source).toContain('ROLLBACK;');
    expect(migration).toContain('DEFAULT 0');
    expect(migration).toContain('CHECK ("firstCommentDelayMinutes" >= 0)');
  });

  it('rehearses the WordPress recipe source and plan ledger', () => {
    const source = readFileSync(script, 'utf8');
    const migration = baselineBlock('20261031140000_rebuild_wordpress_sources');

    expect(source).toContain("ARRAY['wordpress_recipe_plans','slotAt']");
    expect(migration).toContain('CREATE UNIQUE INDEX "wordpress_recipe_plans_slot_key" ON "wordpress_recipe_plans" ("sourceId", "targetId", "slotAt")');
    expect(migration).toContain('rebuild_reject_purging_workspace_write()');
  });
});
