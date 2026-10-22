import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
const name = '20261031120000_rebuild_facebook_sync_cursors';
const migration = readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8');
describe('Facebook cursor persistence boundary', () => {
 it('pins the migration and refuses an already migrated scratch dump', () => {
  const script = readFileSync('scripts/cutover-rehearsal.sh', 'utf8');
  expect(script).toContain(`verify_migration ${name} ${createHash('sha256').update(migration).digest('hex')}`);
  expect(script).toContain(`-f "$migration_dir/${name}/migration.sql"`);
  expect(script).toContain("to_regclass('public.rebuild_facebook_sync_cursors') IS NOT NULL");
 });
 it('migrates exact joined keys before deleting obsolete configuration state', () => {
  expect(migration).toContain("s.key = 'facebook.history.' || t.\"workspaceId\" || '.' || t.id || '.' || t.\"providerId\"");
  expect(migration.indexOf('DELETE FROM app_settings')).toBeGreaterThan(migration.indexOf('INSERT INTO rebuild_facebook_sync_cursors'));
 });
 it('participates in catalog export/erasure and rejects mismatched bindings and purge writes', () => {
  expect(migration).toContain('REFERENCES workspaces(id) ON DELETE CASCADE');
  expect(migration).toContain('REFERENCES targets(id) ON DELETE CASCADE');
  expect(migration).toContain('EXECUTE FUNCTION rebuild_reject_purging_workspace_write()');
  expect(migration).toContain('AND "workspaceId" = NEW."workspaceId" AND "providerId" = NEW."providerId"');
  const service = readFileSync('src/server/data-control/index.ts', 'utf8');
  expect(service).toContain("fk.confrelid = 'public.workspaces'::regclass");
  expect(service).toContain('datasets[table]');
 });
 it('uses scoped transaction SQL instead of Root state', () => {
  const jobs = readFileSync('src/platforms/facebook/jobs.ts', 'utf8');
  expect(jobs).not.toContain('facebook.history.');
  expect(jobs).toContain('SELECT cursor FROM rebuild_facebook_sync_cursors WHERE "workspaceId" = ${target.workspaceId} AND "targetId" = ${target.id}');
  expect(jobs).toContain('await tx.$executeRaw`INSERT INTO rebuild_facebook_sync_cursors');
 });
});
