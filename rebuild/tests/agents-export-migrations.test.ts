import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = (path: string) => readFileSync(path, 'utf8');
describe('agents and private export migrations', () => {
 it.each([
  ['20261101100000_rebuild_writing_agents', 'agents/server/schema.sql'],
  ['20261101100100_rebuild_post_exports', 'publishing/server/export/schema.sql'],
 ])('versions the complete module schema at the repository root: %s', (name, source) => {
  expect(read(`prisma/migrations/${name}/migration.sql`)).toBe(read(`src/modules/${source}`).split('\n').slice(1).join('\n'));
 });
 it('binds run history to its tenant and preserves deleted-agent history', () => {
  const sql = read('prisma/migrations/20261101100000_rebuild_writing_agents/migration.sql');
  expect(sql).toContain('FOREIGN KEY ("agentId", "workspaceId")');
  expect(sql).toContain('ON DELETE SET NULL ("agentId")');
 });
 it('binds export attempts to both workspace and user and cascades private artifacts', () => {
  const sql = read('prisma/migrations/20261101100100_rebuild_post_exports/migration.sql');
  expect(sql).toContain('FOREIGN KEY ("exportId", "workspaceId", "userId")');
  expect(sql).toContain('REFERENCES rebuild_post_exports(id, "workspaceId", "userId") ON DELETE CASCADE');
 });
});
