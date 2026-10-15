import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = 'scripts/cutover-rehearsal.sh';
const approvedMigrationSet = '20261015120000_mcp_api_keys,20261023100000_rebuild_worker_jobs';

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

  it('pins exactly the two reviewed migration files and applies them before mapped-schema checks', () => {
    const source = readFileSync(script, 'utf8');
    const root = readFileSync('../prisma/migrations/20261015120000_mcp_api_keys/migration.sql', 'utf8');
    const worker = readFileSync('../prisma/migrations/20261023100000_rebuild_worker_jobs/migration.sql', 'utf8');
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');

    expect(source).toContain(hash(root));
    expect(source).toContain(hash(worker));
    expect(source).toContain('CUTOVER_APPROVED_MIGRATION_SET');
    expect(source.indexOf('migration.sql"')) .toBeLessThan(source.indexOf('Required tables/columns are taken'));
    expect(source).toContain('staging dump already contains reviewed migration objects');
    expect(source).toContain("WHERE n.nspname = 'public' AND c.relkind = 'r'");
    expect(source).toContain('backup/restore row counts changed');
  });
});
