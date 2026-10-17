import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = 'scripts/cutover-rehearsal.sh';
const approvedMigrationSet = '20261015120000_mcp_api_keys,20261023100000_rebuild_worker_jobs,20261016190000_rebuild_inbox_deletions,20261016220000_rebuild_post_deletions,20261017010000_rebuild_publication_attempts';

describe('cutover rehearsal safety gates', () => {
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

  it('pins the reviewed migration files and applies them before mapped-schema checks', () => {
    const source = readFileSync(script, 'utf8');
    const root = readFileSync('../prisma/migrations/20261015120000_mcp_api_keys/migration.sql', 'utf8');
    const worker = readFileSync('../prisma/migrations/20261023100000_rebuild_worker_jobs/migration.sql', 'utf8');
    const inbox = readFileSync('../prisma/migrations/20261016190000_rebuild_inbox_deletions/migration.sql', 'utf8');
    const postDeletion = readFileSync('../prisma/migrations/20261016220000_rebuild_post_deletions/migration.sql', 'utf8');
    const publicationAttempts = readFileSync('../prisma/migrations/20261017010000_rebuild_publication_attempts/migration.sql', 'utf8');
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');

    expect(source).toContain(hash(root));
    expect(source).toContain(hash(worker));
    expect(source).toContain(hash(inbox));
    expect(source).toContain(hash(postDeletion));
    expect(source).toContain(hash(publicationAttempts));
    expect(source).toContain('migration_name IN ($1, $2, $3, $4, $5)');
    expect(source).toContain("USING '20261015120000_mcp_api_keys', '20261023100000_rebuild_worker_jobs', '20261016190000_rebuild_inbox_deletions', '20261016220000_rebuild_post_deletions', '20261017010000_rebuild_publication_attempts'");
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
});
