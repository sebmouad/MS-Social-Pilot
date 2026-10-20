import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ sql: [] as string[], catalog: [] as object[], counts: {} as Record<string, string>, disconnects: 0 }));
vi.mock('../generated/client', async original => {
  const actual = await original<typeof import('../generated/client')>();
  return { ...actual, PrismaClient: class {
    async $disconnect() { fixture.disconnects++; }
    async $transaction(run: (tx: object) => Promise<unknown>) {
      return run({
        $executeRawUnsafe: async (sql: string) => { fixture.sql.push(sql); },
        $queryRawUnsafe: async (sql: string) => {
          fixture.sql.push(sql);
          if (sql.includes('information_schema.columns')) return fixture.catalog;
          if (sql.includes('FROM pg_constraint')) return [];
          if (/^SELECT count\(\*\)::text AS n FROM public\."[^\"]+"$/.test(sql)) return [{ n: fixture.counts[/public\."([^\"]+)"/.exec(sql)![1]] }];
          if (sql.startsWith('SELECT count(*)')) return [{ n: sql.includes('NOT IN') && sql.includes('public."posts"') || sql.includes('NOT EXISTS') && sql.includes('c."socialAccountId"') ? '1' : '0' }];
          if (sql.includes('FROM public.posts ORDER')) return [{ workspaceId: 'synthetic-ws', media: { malformed: true } }];
          if (sql.includes('FROM public.mcp_api_keys')) return [{ workspaceId: 'synthetic-ws', createdById: 'synthetic-user', resourceScope: { version: 99 }, readFeatures: ['unknown'], writeFeatures: [] }];
          if (sql.includes('FROM public.app_settings')) return [];
          if (sql.includes('FROM public.media')) return [];
          if (sql.includes('FROM public.memberships')) return [{ id: 'synthetic-member' }];
          throw new Error('Unrecognized fixture query');
        },
      });
    }
  } };
});

import { Prisma } from '../generated/client';
import { inspectDatabase, type Baseline } from '../scripts/verify-legacy-migration';

it('reports enum, orphan, JSON and credential-scope failures from aggregate SQL fixtures, with read-only first', async () => {
  fixture.sql = []; fixture.counts = {}; fixture.catalog = [];
  for (const model of Prisma.dmmf.datamodel.models) {
    const table = model.dbName ?? model.name;
    fixture.counts[table] = '0';
    for (const field of model.fields.filter(f => f.kind !== 'object')) fixture.catalog.push({ table_name: table, column_name: field.dbName ?? field.name });
  }
  for (const [table, cols] of Object.entries({ media: ['id', 'workspaceId', 'storageKey', 'storageProvider'], member_page_access: ['membershipId', 'targetId'] })) {
    fixture.counts[table] = '0';
    for (const column of cols) fixture.catalog.push({ table_name: table, column_name: column });
  }
  const root = await mkdtemp(path.join(tmpdir(), 'migration-sql-fixture-'));
  try {
    const baseline: Baseline = { version: 1, counts: fixture.counts, rootKeys: [] };
    const report = await inspectDatabase('postgresql://localhost/synthetic_rehearsal', { baseline, mediaRoot: root });
    expect('ok' in report && report.ok).toBe(false);
    expect('checks' in report && report.checks).toEqual(expect.arrayContaining([
      { table: 'posts', rule: 'enum:status', failures: '1' },
      { table: 'targets', rule: 'relation:socialAccount', failures: '1' },
      { table: 'posts', rule: 'media_shape', failures: '1' },
      { table: 'mcp_api_keys', rule: 'resource_scope_shape', failures: '1' },
      { table: 'mcp_api_keys', rule: 'feature_scope', failures: '1' },
    ]));
    expect(fixture.sql[0]).toBe('SET TRANSACTION READ ONLY');
    expect(fixture.sql.every(sql => !/^(INSERT|UPDATE|DELETE|CREATE|DROP)/.test(sql))).toBe(true);
    expect(fixture.sql.some(sql => sql.includes('j."membershipId"') && sql.includes('IS DISTINCT FROM'))).toBe(true);
    expect(JSON.stringify(report)).not.toContain('synthetic-user');
    expect(fixture.disconnects).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
