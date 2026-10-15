import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = 'scripts/cutover-rehearsal.sh';

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
});
