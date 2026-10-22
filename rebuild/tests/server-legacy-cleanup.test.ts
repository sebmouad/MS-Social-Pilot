import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The server cleanup cannot be executed in tests: it removes production units,
// directories and tables. These pins lock its safety properties instead.
describe('server legacy cleanup guards', () => {
  const script = readFileSync('scripts/server-legacy-cleanup.sh', 'utf8');
  it('requires explicit confirmation and a serving rebuild before anything destructive', () => {
    expect(script).toContain('LEGACY_CLEANUP_CONFIRM=YES');
    expect(script).toContain('systemctl is-active --quiet social-pilot-rebuild');
    expect(script).toContain('systemctl is-active --quiet social-pilot-rebuild-worker');
  });
  it('takes a fresh backup and prints row counts before dropping', () => {
    expect(script).toContain("DUMP_DIR=\"/var/backups/legacy-cleanup-$STAMP\"");
    expect(script).toContain('pg_dump -Fc -f "$DUMP_DIR/social_pilot.dump" social_pilot');
    expect(script.indexOf('pg_dump')).toBeLessThan(script.indexOf('DROP TABLE'));
    expect(script).toContain('exists with $rows rows');
  });
  it('drops only tables the shipped rebuild schema does not map, in one transaction', () => {
    expect(script).toContain('TABLES=\'workspace_exports "OAuthClient" "OAuthCode" api_tokens snippets\'');
    expect(script).toContain("grep -o '@@map(\"[^\"]*\")' /var/tmp/legacy-cleanup/prisma/schema.prisma");
    expect(script).toContain('refusing: $t is mapped by the rebuild schema');
    expect(script).toContain('DROP TABLE IF EXISTS public.workspace_exports, public."OAuthClient", public."OAuthCode", public.api_tokens, public.snippets;');
    const txn = script.slice(script.indexOf('BEGIN;'), script.indexOf('COMMIT;'));
    expect(txn).toContain('DROP TABLE IF EXISTS');
  });
  it('removes only the exact legacy units, directories and guard, never media or rebuild paths', () => {
    for (const unit of ['social-pilot.service', 'social-pilot-worker.service']) {
      expect(script).toContain(unit);
      expect(script).not.toContain(`rm -rf -- /etc/systemd/system/social-pilot-rebuild`);
    }
    expect(script).toContain('for dir in /srv/ms-social-pilot /srv/ms-social-pilot.prev; do');
    expect(script).toContain('rm -f /usr/local/sbin/socialpilot-deploy');
    expect(script).toContain('will not be touched');
    expect(script).not.toMatch(/rm -rf -- \/var\/lib\/ms-social-pilot/);
    expect(script).not.toMatch(/rm -rf -- \/srv\/ms-social-pilot-rebuild/);
    expect(script).not.toMatch(/DROP TABLE[^;]*rebuild_/);
  });
});
