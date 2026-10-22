import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_TABLES, countSql, deleteGate, inboundForeignKeysSql, isLegacyTable, isRebuildOwned, orphanWorkspaceSql,
} from '../scripts/legacy-data-manifest';
import { evaluate, printSql, type TableReport } from '../scripts/legacy-data-audit';

const schema = readFileSync(path.resolve(process.cwd(), 'prisma/legacy-schema.prisma'), 'utf8');
const parsed = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(m => ({
  model: m[1],
  table: /@@map\("(\w+)"\)/.exec(m[2])?.[1] ?? m[1],
  workspace: /^\s+workspaceId\s+String(\?)?/m.exec(m[2]) ? (/^\s+workspaceId\s+String\?/m.test(m[2]) ? 'optional' : 'required') : 'none',
}));

describe('legacy data manifest', () => {
  it('classifies every legacy Prisma model exactly once', () => {
    const tables = LEGACY_TABLES.map(e => e.table);
    expect(new Set(tables).size).toBe(tables.length);
    expect([...tables].sort()).toEqual(parsed.map(p => p.table).sort());
  });

  it('matches model names and workspace columns in prisma/schema.prisma', () => {
    const mismatches = parsed.filter(p => {
      const entry = LEGACY_TABLES.find(e => e.table === p.table);
      return !entry || entry.model !== p.model || entry.workspace !== p.workspace;
    }).map(p => `${p.table}:${p.workspace}`);
    expect(mismatches).toEqual([]);
  });

  it('builds quoted read-only SQL', () => {
    expect(countSql('OAuthCode')).toBe('SELECT count(*)::text AS n FROM public."OAuthCode"');
    const posts = LEGACY_TABLES.find(e => e.table === 'posts')!;
    expect(orphanWorkspaceSql(posts)).toContain('LEFT JOIN public.workspaces');
    expect(orphanWorkspaceSql(LEGACY_TABLES.find(e => e.table === 'users')!)).toBeNull();
    expect(inboundForeignKeysSql('media')).toContain("'public.\"media\"'::regclass");
    const sql = printSql();
    expect(sql.startsWith('-- Read-only')).toBe(true);
    expect(sql).toMatch(/BEGIN READ ONLY;[\s\S]*ROLLBACK;/);
    expect(sql).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/im);
    for (const e of LEGACY_TABLES) expect(sql).toContain(`public."${e.table}"`);
  });

  it('separates rebuild-owned tables from unclassified ones', () => {
    expect(isRebuildOwned('rebuild_job_leases')).toBe(true);
    expect(isRebuildOwned('ads_objects')).toBe(true);
    expect(isRebuildOwned('mystery_table')).toBe(false);
    expect(isLegacyTable('tasks')).toBe(true);
  });

  it('gates deletion by disposition and rows', () => {
    const by = (t: string) => LEGACY_TABLES.find(e => e.table === t)!;
    expect(deleteGate(by('posts'), 10)).toBe('keep');
    expect(deleteGate(by('ai_agents'), 3)).toBe('keep');
    expect(deleteGate(by('uptime_days'), 3)).toBe('decision_required');
    expect(deleteGate(by('uptime_days'), 0)).toBe('retire_after_backup');
    expect(deleteGate(by('workspace_exports'), 3)).toBe('retire_after_backup');
  });

  it('fails on orphans, unvalidated constraints and unclassified tables', () => {
    const report = (table: string, orphans: string | null): TableReport => ({
      table, disposition: 'in_place', access: 'sql', owner: 'x', present: true, rows: '1',
      workspaceOrphans: orphans, gate: 'keep', inboundForeignKeys: [],
    });
    expect(evaluate([report('tasks', '0'), report('users', null)], [], [])).toEqual([]);
    const failures = evaluate([report('tasks', '2')], ['mystery'], ['posts.fk']);
    expect(failures).toHaveLength(3);
  });
});
