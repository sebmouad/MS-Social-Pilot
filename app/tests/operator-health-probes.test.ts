import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('operator release readiness probes', () => {
  it('uses database-backed health locally and publicly while retaining the sign-in origin check', () => {
    const script = readFileSync('scripts/deploy.sh', 'utf8');
    expect(script).toContain('http://127.0.0.1:3100/api/health');
    expect(script).toContain('$PUBLIC_ORIGIN/api/health');
    expect(script).not.toContain('http://127.0.0.1:3100/sign-in');
    expect(script).toContain('/api/auth/sign-in');
    expect(script).toContain('[ "$csrf" = 401 ]');
  });
  it('marks the baseline applied on migrated databases instead of re-running it', () => {
    const script = readFileSync('scripts/deploy.sh', 'utf8');
    expect(script).toContain('BASELINE=20261103000000_baseline');
    expect(script).toContain('CREATE TABLE IF NOT EXISTS "_prisma_migrations"');
    expect(script).toContain("migration_name <> '$BASELINE'");
    expect(script).toContain('marked applied (');
    expect(script).toContain('not re-run.');
    expect(script).not.toMatch(/psql -d social_pilot -v ON_ERROR_STOP=1 -q -1 < "\$f"/);
  });
});
