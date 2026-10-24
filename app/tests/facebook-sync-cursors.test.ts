import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE_NAME, BASELINE_SHA256, baselineBlock } from './baseline-block';
const name = '20261031120000_rebuild_facebook_sync_cursors';
const migration = baselineBlock(name);
describe('Facebook cursor persistence boundary', () => {
 it('is pinned inside the baseline rehearsal on an empty scratch database', () => {
  const script = readFileSync('scripts/cutover-rehearsal.sh', 'utf8');
  expect(script).toContain(`verify_migration ${BASELINE_NAME} ${BASELINE_SHA256}`);
  expect(script).toContain(`-f "$migration_dir/${BASELINE_NAME}/migration.sql"`);
  expect(script).toContain('scratch database is not empty; refusing to apply the baseline');
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
