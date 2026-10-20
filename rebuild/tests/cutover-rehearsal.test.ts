import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = 'scripts/cutover-rehearsal.sh';
const approvedMigrationSet = '20261015120000_mcp_api_keys,20261023100000_rebuild_worker_jobs,20261016190000_rebuild_inbox_deletions,20261016220000_rebuild_post_deletions,20261017010000_rebuild_publication_attempts,20261017020000_rebuild_facebook_media_steps,20261017030000_rebuild_facebook_media_deletions,20261017040000_rebuild_facebook_media_resolution,20261018150000_rebuild_notifications,20261018170000_rebuild_ads_operations,20261018190000_rebuild_ads_creation,20261018193000_rebuild_purge_write_gates,20261025100000_rebuild_task_comments,20261018230000_rebuild_sharing_expiry,20261018233000_rebuild_mcp_resource_scope,20261019010000_rebuild_report_runs,20261019011000_rebuild_report_purge_gate,20261019020000_rebuild_destination_formats,20261019030000_rebuild_facebook_native_journal,20261019040000_rebuild_facebook_native_status_proofs,20261019050000_rebuild_publication_submissions,20261019060000_rebuild_template_comment_delay,20261026100000_rebuild_oauth_connectors,20261027100000_rebuild_workspace_exports,20261028100000_rebuild_alert_delivery,20261029100000_rebuild_channel_profiles,20261030100000_rebuild_facebook_native_story_proofs,20261030100000_rebuild_review_resolution,20261030110000_rebuild_ads_creative_creation,20261030120000_rebuild_workspace_watermark,20261030130000_rebuild_comment_sentiment,20261030130000_rebuild_person_mcp_keys,20261030140000_rebuild_facebook_native_schedule_changes,20261031100000_rebuild_destination_schedule_mode';

describe('cutover rehearsal safety gates', () => {
  it('pins report run migrations, refuses already migrated objects/history, and proves the purge gate', () => {
    const source = readFileSync(script, 'utf8');
    const runs = readFileSync('../prisma/migrations/20261019010000_rebuild_report_runs/migration.sql', 'utf8');
    const purgeGate = readFileSync('../prisma/migrations/20261019011000_rebuild_report_purge_gate/migration.sql', 'utf8');
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');
    expect(hash(runs)).toBe('caa0c553569cf9f984e973ceb6e3ee858750209c6d2931e1316d3323b4357c4a');
    expect(hash(purgeGate)).toBe('122e813070361737ba1a89d775d2f92922dadd36423debb83411e0d5a4aa5d9e');
    expect(source).toContain(`verify_migration 20261019010000_rebuild_report_runs ${hash(runs)}`);
    expect(source).toContain(`verify_migration 20261019011000_rebuild_report_purge_gate ${hash(purgeGate)}`);
    const reportRunsApply = source.indexOf('migration_dir/20261019010000_rebuild_report_runs/migration.sql');
    const reportGateApply = source.indexOf('migration_dir/20261019011000_rebuild_report_purge_gate/migration.sql');
    expect(reportRunsApply).toBeGreaterThan(source.indexOf('migration_dir/20261018193000_rebuild_purge_write_gates/migration.sql'));
    expect(reportGateApply).toBeGreaterThan(reportRunsApply);
    expect(source).toContain("to_regclass('public.report_runs') IS NOT NULL");
    expect(source).toContain("tgrelid = to_regclass('public.report_runs')");
    expect(source).toContain('migration_name IN ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)');
    expect(source).toContain("'20261019010000_rebuild_report_runs', '20261019011000_rebuild_report_purge_gate'");
    expect(source).toContain("t.tgfoid = to_regprocedure('public.rebuild_reject_purging_workspace_write()')");
    expect(source).toContain("t.tgenabled IN ('O', 'A')");
    for (const column of ['id', 'workspaceId', 'scheduleId', 'targetId', 'kind', 'idempotencyKey', 'claimToken', 'requestHash', 'periodStart', 'periodEnd', 'status', 'leaseUntil', 'startedAt', 'finishedAt', 'rowCount', 'truncated', 'failureReason', 'deliveries', 'requestedById', 'output', 'outputExpiresAt', 'createdAt']) {
      expect(source).toContain(`ARRAY['report_runs','${column}']`);
    }
  });

  it('pins sharing expiry and refuses a partially migrated baseline', () => {
    const source = readFileSync(script, 'utf8');
    const migration = readFileSync('../prisma/migrations/20261018230000_rebuild_sharing_expiry/migration.sql', 'utf8');
    expect(createHash('sha256').update(migration).digest('hex')).toBe('28d4f9da65ed866f6139aa982d4756906cd329080dccf6cf2d87dee32e59d263');
    expect(source).toContain('verify_migration 20261018230000_rebuild_sharing_expiry 28d4f9da65ed866f6139aa982d4756906cd329080dccf6cf2d87dee32e59d263');
    expect(source).toContain("table_name = 'share_links' AND column_name = 'expiresAt'");
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
          CUTOVER_STAGING_DUMP: script,
          CUTOVER_DUMP_SANITIZED: 'YES',
          CUTOVER_APPROVED_MIGRATION_SET: approvedMigrationSet,
          CUTOVER_ADMIN_URL: 'postgresql://user:secret@production.example:5432/postgres',
        },
      });
    } catch (error) {
      output = `${(error as { stderr?: string }).stderr ?? ''}`;
    }
    expect(output).toContain('admin URL must target loopback');
  });

  it('requires a supplied staging dump and never accepts an implicit database URL', () => {
    let output = '';
    try {
      execFileSync('bash', [script], {
        encoding: 'utf8',
        env: { ...process.env, CUTOVER_STAGING_DUMP: '', CUTOVER_ADMIN_URL: '' },
      });
    } catch (error) {
      output = `${(error as { stderr?: string }).stderr ?? ''}`;
    }
    expect(output).toContain('Set CUTOVER_STAGING_DUMP');
  });

  it('requires explicit sanitization attestation and the exact migration allowlist', () => {
    const run = (environment: Record<string, string>) => {
      try {
        execFileSync('bash', [script], {
          encoding: 'utf8',
          env: { ...process.env, CUTOVER_STAGING_DUMP: script, CUTOVER_ADMIN_URL: 'postgresql://postgres@localhost/postgres', ...environment },
        });
        return '';
      } catch (error) {
        return `${(error as { stderr?: string }).stderr ?? ''}`;
      }
    };

    expect(run({ CUTOVER_DUMP_SANITIZED: 'NO', CUTOVER_APPROVED_MIGRATION_SET: approvedMigrationSet })).toContain('CUTOVER_DUMP_SANITIZED must be YES');
    expect(run({ CUTOVER_DUMP_SANITIZED: 'YES', CUTOVER_APPROVED_MIGRATION_SET: 'all' })).toContain('migration set must exactly match');
  });

  it('pins the Ads ledger and refuses already applied baselines', () => {
    const source = readFileSync(script, 'utf8');
    const migration = readFileSync('../prisma/migrations/20261018170000_rebuild_ads_operations/migration.sql', 'utf8');
    expect(createHash('sha256').update(migration).digest('hex')).toBe('61f575314590e45e8eafc7cb8088677fec2a78b39210b82187b6f2c05197d6d2');
    expect(source).toContain('verify_migration 20261018170000_rebuild_ads_operations 61f575314590e45e8eafc7cb8088677fec2a78b39210b82187b6f2c05197d6d2');
    expect(source).toContain("to_regclass('public.ads_management_operations')");
    expect(source).toContain("to_regprocedure('public.rebuild_facebook_media_deletions_binding_immutable()')");
    expect(source).toContain("to_regprocedure('public.rebuild_facebook_media_resolutions_immutable()')");
    expect(source).toContain("ARRAY['ads_management_operations','requestHash']");
  });

  it('pins creation operation kinds after the Ads ledger migration', () => {
    const source = readFileSync(script, 'utf8');
    const migration = readFileSync('../prisma/migrations/20261018190000_rebuild_ads_creation/migration.sql', 'utf8');
    expect(createHash('sha256').update(migration).digest('hex')).toBe('749fc69e2937588b95e7b050ebb49525e30b2624915abd2bdc92de6e92a899d0');
    expect(source).toContain('verify_migration 20261018190000_rebuild_ads_creation 749fc69e2937588b95e7b050ebb49525e30b2624915abd2bdc92de6e92a899d0');
    expect(source.indexOf('migration_dir/20261018190000_rebuild_ads_creation/migration.sql')).toBeGreaterThan(source.indexOf('migration_dir/20261018170000_rebuild_ads_operations/migration.sql'));
    expect(migration).toContain("'campaign.create'");
    expect(migration).toContain("'adset.create'");
  });

  it('pins the purge gate and task comments, applies them in dependency order and refuses migrated baselines', () => {
    const source = readFileSync(script, 'utf8');
    const purge = readFileSync('../prisma/migrations/20261018193000_rebuild_purge_write_gates/migration.sql', 'utf8');
    const comments = readFileSync('../prisma/migrations/20261025100000_rebuild_task_comments/migration.sql', 'utf8');
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');
    expect(source).toContain(`verify_migration 20261018193000_rebuild_purge_write_gates ${hash(purge)}`);
    expect(source).toContain(`verify_migration 20261025100000_rebuild_task_comments ${hash(comments)}`);
    expect(source).not.toContain('PENDING_SHA256_');
    // The comments migration creates a trigger on a function installed by the purge migration.
    expect(comments).toContain('rebuild_reject_purging_workspace_write()');
    expect(purge).toContain('CREATE OR REPLACE FUNCTION public.rebuild_reject_purging_workspace_write()');
    const apply = (name: string) => source.indexOf(`migration_dir/${name}/migration.sql`);
    expect(apply('20261018193000_rebuild_purge_write_gates')).toBeGreaterThan(apply('20261018190000_rebuild_ads_creation'));
    expect(apply('20261025100000_rebuild_task_comments')).toBeGreaterThan(apply('20261018193000_rebuild_purge_write_gates'));
    expect(source.indexOf('Required tables/columns are taken')).toBeGreaterThan(apply('20261025100000_rebuild_task_comments'));
    expect(source).toContain("to_regclass('public.workspace_data_purges')");
    expect(source).toContain("to_regclass('public.task_comments')");
    expect(source).toContain('workspace_data_purges prerequisite table is missing');
    expect(source).not.toContain("OR to_regclass('public.workspace_data_purges') IS NOT NULL");
    expect(source).toContain("ARRAY['task_comments','workspaceId']");
    expect(source).toContain("'20261018193000_rebuild_purge_write_gates', '20261025100000_rebuild_task_comments'");
  });

  it('pins notifications and refuses an already migrated notification baseline', () => {
    const source = readFileSync(script, 'utf8');
    const migration = readFileSync('../prisma/migrations/20261018150000_rebuild_notifications/migration.sql', 'utf8');
    expect(createHash('sha256').update(migration).digest('hex')).toBe('b60b92752dc3019e15156f1ecb4cb58d29b5de4a6676dd141ac13a955277b067');
    expect(source).toContain('verify_migration 20261018150000_rebuild_notifications b60b92752dc3019e15156f1ecb4cb58d29b5de4a6676dd141ac13a955277b067');
    expect(source).toContain("to_regclass('public.rebuild_notifications')");
    expect(source).toContain("ARRAY['rebuild_notifications','claimUntil']");
  });

  it('pins the reviewed migration files and applies them before mapped-schema checks', () => {
    const source = readFileSync(script, 'utf8');
    const root = readFileSync('../prisma/migrations/20261015120000_mcp_api_keys/migration.sql', 'utf8');
    const worker = readFileSync('../prisma/migrations/20261023100000_rebuild_worker_jobs/migration.sql', 'utf8');
    const inbox = readFileSync('../prisma/migrations/20261016190000_rebuild_inbox_deletions/migration.sql', 'utf8');
    const postDeletion = readFileSync('../prisma/migrations/20261016220000_rebuild_post_deletions/migration.sql', 'utf8');
    const publicationAttempts = readFileSync('../prisma/migrations/20261017010000_rebuild_publication_attempts/migration.sql', 'utf8');
    const mediaSteps = readFileSync('../prisma/migrations/20261017020000_rebuild_facebook_media_steps/migration.sql', 'utf8');
    const mediaDeletions = readFileSync('../prisma/migrations/20261017030000_rebuild_facebook_media_deletions/migration.sql', 'utf8');
    const resolutions = readFileSync('../prisma/migrations/20261017040000_rebuild_facebook_media_resolution/migration.sql', 'utf8');
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');

    expect(source).toContain(hash(root));
    expect(source).toContain(hash(worker));
    expect(source).toContain(hash(inbox));
    expect(source).toContain(hash(postDeletion));
    expect(source).toContain(hash(publicationAttempts));
    expect(source).toContain(hash(mediaSteps));
    expect(source).toContain(hash(mediaDeletions));
    expect(source).toContain(hash(resolutions));
    expect(source).toContain('migration_name IN ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)');
    expect(source).toContain("USING '20261015120000_mcp_api_keys', '20261023100000_rebuild_worker_jobs', '20261016190000_rebuild_inbox_deletions', '20261016220000_rebuild_post_deletions', '20261017010000_rebuild_publication_attempts', '20261017020000_rebuild_facebook_media_steps'");
    expect(source).toContain('CUTOVER_APPROVED_MIGRATION_SET');
    expect(source.indexOf('migration.sql"')) .toBeLessThan(source.indexOf('Required tables/columns are taken'));
    expect(source).toContain('staging dump already contains reviewed migration objects');
    expect(source).toContain("WHERE n.nspname = 'public' AND c.relkind = 'r'");
    expect(source).toContain('backup/restore row counts changed');
    expect(source).toContain("ARRAY['rebuild_inbox_deletions','remoteConfirmedAt']");
    expect(source).toContain("ARRAY['rebuild_inbox_deletions','completedAt']");
    expect(source).toContain("ARRAY['rebuild_inbox_deletions','localAliases']");
    expect(source).toContain("ARRAY['rebuild_inbox_deletions','suppressedRemoteIds']");
    expect(source).toContain("ARRAY['rebuild_post_deletions','localPostIds']");
    expect(source).toContain("ARRAY['rebuild_post_deletions','localPostTargetIds']");
    expect(source).toContain("ARRAY['rebuild_publication_attempts','attestedBy']");
    expect(source).toContain("ARRAY['rebuild_publication_attempts','remotePostId']");
    expect(source).toContain('20261016220000_rebuild_post_deletions');
    expect(source).toContain('80e406ae33000a349d07f9e428563d20083bc36c65956a969a5e7ccc77c32f07');
    expect(source).toContain('988d873c33229b439818d079d72c8bc49ffec93cbfe081ee4061ef93d2b2b3f4');
    expect(source).toContain('5fb7962a2c720f8a3f30480c4c5afa6f0d48c92a8f2ee58047fb96ccf04a7205');
    expect(source).toContain('457327ad55d02af41eefe00f56021923abe5e13cf7ca668a96c064fa714acc57');
    expect(source).toContain("to_regclass('public.rebuild_post_deletions')");
    expect(source).toContain('migration_dir/20261016220000_rebuild_post_deletions/migration.sql');
    expect(source).toContain('migration_dir/20261017010000_rebuild_publication_attempts/migration.sql');
    expect(source).toContain('migration_dir/20261017020000_rebuild_facebook_media_steps/migration.sql');
    expect(source).toContain("to_regclass('public.rebuild_facebook_media_steps')");
    expect(source).toContain('migration_dir/20261017030000_rebuild_facebook_media_deletions/migration.sql');
    expect(source).toContain("to_regclass('public.rebuild_facebook_media_deletions')");
    for (const column of ['id', 'workspaceId', 'mediaStepId', 'operationId', 'postId', 'postTargetId', 'targetId', 'remoteTargetId', 'remotePhotoId', 'actorId', 'state', 'receiptAt', 'createdAt', 'updatedAt']) expect(source).toContain("ARRAY['rebuild_facebook_media_deletions','" + column + "']");
    expect(source).toContain('migration_dir/20261017040000_rebuild_facebook_media_resolution/migration.sql');
    expect(source).toContain("to_regclass('public.rebuild_facebook_media_resolutions')");
    for (const column of ['id', 'workspaceId', 'operationId', 'mediaStepId', 'deletionId', 'postId', 'postTargetId', 'targetId', 'remoteTargetId', 'publicationActorId', 'eventActorId', 'phase', 'ordinal', 'source', 'outcome', 'remoteId', 'createdAt']) expect(source).toContain("ARRAY['rebuild_facebook_media_resolutions','" + column + "']");
    for (const column of ['workspaceId', 'operationId', 'phase', 'ordinal', 'state', 'remoteId', 'receiptAt']) expect(source).toContain("ARRAY['rebuild_facebook_media_steps','" + column + "']");
  });

  it('maps the content-free deletion journal and guards its SQL constraints', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const migration = readFileSync('../prisma/migrations/20261016190000_rebuild_inbox_deletions/migration.sql', 'utf8');
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

  it('pins the native Facebook journal as a raw module table with parent and purge guards', () => {
    const source = readFileSync(script, 'utf8');
    const migration = readFileSync('../prisma/migrations/20261019030000_rebuild_facebook_native_journal/migration.sql', 'utf8');
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const hash = createHash('sha256').update(migration).digest('hex');
    const apply = (name: string) => source.indexOf(`migration_dir/${name}/migration.sql`);

    expect(hash).toBe('3ef505dccb5156ea1d84472998d19fb8427b1232669f57ca98a8ac6cd1e04d46');
    expect(source).toContain(`verify_migration 20261019030000_rebuild_facebook_native_journal ${hash}`);
    expect(source).toContain(approvedMigrationSet);
    expect(apply('20261019030000_rebuild_facebook_native_journal')).toBeGreaterThan(apply('20261019020000_rebuild_destination_formats'));
    expect(source).toContain('migration_name IN ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)');
    expect(source).toContain("'20261019020000_rebuild_destination_formats', '20261019030000_rebuild_facebook_native_journal', '20261019040000_rebuild_facebook_native_status_proofs', '20261019050000_rebuild_publication_submissions', '20261019060000_rebuild_template_comment_delay'");
    expect(source).toContain("to_regclass('public.rebuild_facebook_native_journal') IS NOT NULL");
    expect(source).toContain("to_regprocedure('public.rebuild_facebook_native_journal_guard()') IS NOT NULL");
    expect(source).toContain("to_regprocedure('public.rebuild_publication_attempts_native_binding_guard()') IS NOT NULL");

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

  it('pins and rehearses the identity-bound native status proof ledger', () => {
    const source = readFileSync(script, 'utf8');
    const migration = readFileSync('../prisma/migrations/20261019040000_rebuild_facebook_native_status_proofs/migration.sql', 'utf8');
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const hash = createHash('sha256').update(migration).digest('hex');
    const apply = (name: string) => source.indexOf(`migration_dir/${name}/migration.sql`);

    expect(hash).toBe('253e8fb4f18b4cf60fcce16702772dd166358e641fb875c2781cb84d8dc767d4');
    expect(source).toContain(`verify_migration 20261019040000_rebuild_facebook_native_status_proofs ${hash}`);
    expect(source).toContain(approvedMigrationSet);
    expect(apply('20261019040000_rebuild_facebook_native_status_proofs')).toBeGreaterThan(apply('20261019030000_rebuild_facebook_native_journal'));
    expect(source).toContain("to_regclass('public.rebuild_facebook_native_status_proofs') IS NOT NULL");
    expect(source).toContain("to_regprocedure('public.rebuild_facebook_native_status_proofs_guard()') IS NOT NULL");
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

  it('pins and rehearses template and version first-comment delay constraints', () => {
    const source = readFileSync(script, 'utf8');
    const migration = readFileSync('../prisma/migrations/20261019060000_rebuild_template_comment_delay/migration.sql', 'utf8');
    const hash = createHash('sha256').update(migration).digest('hex');
    const apply = source.indexOf('migration_dir/20261019060000_rebuild_template_comment_delay/migration.sql');

    expect(hash).toBe('4c2f5699a826b8008003718084ee13eb0e4ee37e8e861ffdaf4a8a0a292bcfc5');
    expect(source).toContain(`verify_migration 20261019060000_rebuild_template_comment_delay ${hash}`);
    expect(source).toContain(approvedMigrationSet);
    expect(source).toContain('migration_name IN ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)');
    expect(source).toContain("'20261019050000_rebuild_publication_submissions', '20261019060000_rebuild_template_comment_delay'");
    expect(source).toContain("table_name = 'post_templates' AND column_name = 'firstCommentDelayMinutes'");
    expect(source).toContain("table_name = 'post_versions' AND column_name = 'firstCommentDelayMinutes'");
    expect(apply).toBeGreaterThan(source.indexOf('migration_dir/20261019050000_rebuild_publication_submissions/migration.sql'));
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
});
