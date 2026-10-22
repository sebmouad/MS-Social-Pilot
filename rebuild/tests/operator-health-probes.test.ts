import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// These scripts cannot be executed in tests: they control production services.
describe('operator release readiness probes', () => {
  it('uses database-backed health locally and publicly while retaining the sign-in origin check', () => {
    const script = readFileSync('scripts/prod-deploy.sh', 'utf8');
    expect(script).toContain('http://127.0.0.1:3100/api/health');
    expect(script).toContain('$PUBLIC_ORIGIN/api/health');
    expect(script).not.toContain('http://127.0.0.1:3100/sign-in');
    expect(script).toContain('/api/auth/sign-in');
    expect(script).toContain('[ "$csrf" = 401 ]');
  });
  it('uses the health endpoint for both isolated rollback releases', () => {
    const script = readFileSync('scripts/prod-rollback-drill.sh', 'utf8');
    expect(script).toContain('run_release legacy "$LEGACY" "$LEGACY_PORT" /api/health');
    expect(script).toContain('run_release rebuild "$REBUILD" "$REBUILD_PORT" /api/health');
    expect(script).toContain('default_transaction_read_only=on');
    expect(script).toContain('scratch DB connection confirmed');
  });
});
