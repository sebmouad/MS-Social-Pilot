import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;

/**
 * The Tasks service imports one shared `prisma`. The test points it at a client whose pool size it controls:
 * a single connection proves the write path never opens a second connection while its transaction is open
 * (the old nested-client shape deadlocks there); a larger pool lets two writers genuinely race.
 */
const state = vi.hoisted(() => ({ client: undefined as unknown as Record<string, unknown>, skipPurgeGuard: false }));
vi.mock('../src/server/data', () => ({
  prisma: new Proxy({}, {
    get: (_target, property) => {
      const value = state.client?.[property as string];
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(state.client) : value;
    },
  }),
}));
const config = vi.hoisted(() => ({
  'tasks.titleMaxCharacters': 200, 'tasks.notesMaxCharacters': 2000, 'tasks.commentMaxCharacters': 1000, 'tasks.pageLimit': 50,
  'tasks.commentHistoryLimit': 50, 'tasks.assigneeLimit': 100, 'tasks.postChoiceLimit': 20, 'tasks.workflowRowLimit': 20, 'tasks.workflowGapMaxDays': 30,
  'tasks.transactionTimeoutMs': 10000, 'tasks.transactionMaxWaitMs': 5000,
} as Record<string, number>));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => config[key] }));
vi.mock('../src/server/entitlements', () => ({
  loadEntitlements: async (_userId: string, workspaceId: string) => ({ workspaceId }),
  canUseModule: () => true,
  canUseFeature: () => true,
}));
vi.mock('../src/server/permissions/loader', async () => {
  const { resolvePermissions } = await import('../src/server/permissions');
  return { loadPermissions: async () => resolvePermissions({ role: 'owner', allPages: true, workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], pageAccess: [] }) };
});
// Optionally skip the preflight purge check, to simulate a purge that commits after it and before the write lock.
vi.mock('../src/server/data-control/guard', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/server/data-control/guard')>();
  return { ...actual, assertWorkspaceNotPurging: (workspaceId: string) => state.skipPurgeGuard ? Promise.resolve() : actual.assertWorkspaceNotPurging(workspaceId) };
});

import { performTaskAction } from '../src/modules/tasks/server/tasks';

function isolated(url: string, connectionLimit?: number) {
  const parsed = new URL(url);
  if (process.env.NODE_ENV === 'production' || !['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || !decodeURIComponent(parsed.pathname).endsWith('_preview')
    || ['host', 'hostaddr', 'socket'].some(key => parsed.searchParams.has(key))) throw new Error('Only isolated loopback preview database permitted.');
  if (connectionLimit) { parsed.searchParams.set('connection_limit', String(connectionLimit)); parsed.searchParams.set('pool_timeout', '10'); }
  return new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
}

describe.skipIf(!databaseUrl)('Tasks single-transaction writes on isolated PostgreSQL', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const workspaceId = `preview_tasks78_${suffix}`;
  const userId = `preview_tasks78_user_${suffix}`;
  const actor = { userId, workspaceId };
  let db: PrismaClient;
  let single: PrismaClient;
  let pooled: PrismaClient;

  const count = async (table: 'tasks' | 'activity_logs') => {
    const rows = table === 'tasks'
      ? await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*)::bigint AS n FROM tasks WHERE "workspaceId" = ${workspaceId}`
      : await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*)::bigint AS n FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action LIKE 'tasks.%'`;
    return Number(rows[0]!.n);
  };
  const clean = async () => {
    // Purge rows first: they gate writes on workspace-owned tables.
    await db.$executeRaw`DELETE FROM workspace_data_purges WHERE "workspaceId" = ${workspaceId}`;
    await db.$executeRaw`DELETE FROM task_comments WHERE "workspaceId" = ${workspaceId}`;
    await db.$executeRaw`DELETE FROM tasks WHERE "workspaceId" = ${workspaceId}`;
    await db.$executeRaw`DELETE FROM activity_logs WHERE "workspaceId" = ${workspaceId}`;
    await db.$executeRaw`DELETE FROM memberships WHERE "workspaceId" = ${workspaceId}`;
    await db.$executeRaw`DELETE FROM users WHERE id = ${userId}`;
    await db.$executeRaw`DELETE FROM workspaces WHERE id = ${workspaceId}`;
  };

  beforeAll(async () => {
    db = isolated(databaseUrl!);
    single = isolated(databaseUrl!, 1);
    pooled = isolated(databaseUrl!, 4);
    await clean();
    await db.workspace.create({ data: { id: workspaceId, name: 'Disposable Tasks 78', slug: workspaceId, timezone: 'UTC' } });
    await db.user.create({ data: { id: userId, email: `${userId}@example.invalid`, name: 'Disposable Tasks Editor', passwordHash: 'x' } });
    await db.membership.create({ data: { id: `${userId}_membership`, userId, workspaceId, role: 'editor' } });
  });
  afterAll(async () => {
    state.skipPurgeGuard = false;
    try { if (db) await clean(); } finally {
      await Promise.all([db?.$disconnect(), single?.$disconnect(), pooled?.$disconnect()]);
    }
    // Cleanup is verified, not assumed.
    const check = isolated(databaseUrl!);
    try {
      const rows = await check.$queryRaw<Array<{ n: bigint }>>`SELECT (SELECT COUNT(*) FROM workspaces WHERE id = ${workspaceId}) + (SELECT COUNT(*) FROM users WHERE id = ${userId}) + (SELECT COUNT(*) FROM tasks WHERE "workspaceId" = ${workspaceId}) AS n`;
      expect(Number(rows[0]!.n)).toBe(0);
    } finally { await check.$disconnect(); }
  });

  it('completes a Task create, audit included, on a one-connection pool', async () => {
    state.client = single as unknown as Record<string, unknown>; state.skipPurgeGuard = false;
    const created = await performTaskAction(actor, { action: 'task.create', title: 'Single connection task', notes: 'synthetic' });
    expect(created).toMatchObject({ ok: true, action: 'task.create' });
    const rows = await db.$queryRaw<Array<{ title: string; createdById: string; status: string }>>`SELECT title, "createdById", status FROM tasks WHERE id = ${(created as { id: string }).id}`;
    expect(rows).toEqual([{ title: 'Single connection task', createdById: userId, status: 'todo' }]);
    const audits = await db.$queryRaw<Array<{ action: string; actorId: string }>>`SELECT action, "actorId" FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND detail->>'taskId' = ${(created as { id: string }).id}`;
    expect(audits).toEqual([{ action: 'tasks.created', actorId: userId }]);
  }, 30000);

  it('completes a checklist and a comment on the same one-connection pool', async () => {
    state.client = single as unknown as Record<string, unknown>; state.skipPurgeGuard = false;
    const many = await performTaskAction(actor, { action: 'task.createMany', titles: ['One', 'Two', 'Three'], startOn: '2026-11-01', gapDays: 2 }) as { ids: string[] };
    expect(many.ids).toHaveLength(3);
    const commented = await performTaskAction(actor, { action: 'comment.add', taskId: many.ids[0]!, body: 'Synthetic comment' });
    expect(commented).toMatchObject({ ok: true, action: 'comment.add' });
    const dues = await db.$queryRaw<Array<{ dueOn: string }>>`SELECT "dueOn" FROM tasks WHERE id = ANY(${many.ids}::text[]) ORDER BY "dueOn"`;
    expect(dues.map(row => row.dueOn)).toEqual(['2026-11-01', '2026-11-03', '2026-11-05']);
  }, 30000);

  it('lets exactly one of two simultaneous updates with the same expected version win', async () => {
    state.client = pooled as unknown as Record<string, unknown>; state.skipPurgeGuard = false;
    const created = await performTaskAction(actor, { action: 'task.create', title: 'Contended task' }) as { id: string };
    const loaded = await db.$queryRaw<Array<{ updatedAt: Date }>>`SELECT "updatedAt" FROM tasks WHERE id = ${created.id}`;
    const expectedUpdatedAt = loaded[0]!.updatedAt.toISOString();
    const settled = await Promise.allSettled(['Winner A', 'Winner B'].map(title => performTaskAction(actor, { action: 'task.update', id: created.id, title, expectedUpdatedAt })));
    const fulfilled = settled.filter(item => item.status === 'fulfilled');
    const rejected = settled.filter((item): item is PromiseRejectedResult => item.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: 'conflict' });
    const winner = settled[0]!.status === 'fulfilled' ? 'Winner A' : 'Winner B';
    const rows = await db.$queryRaw<Array<{ title: string }>>`SELECT title FROM tasks WHERE id = ${created.id}`;
    expect(rows[0]!.title).toBe(winner);
    const audits = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*)::bigint AS n FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'tasks.updated' AND detail->>'taskId' = ${created.id}`;
    expect(Number(audits[0]!.n)).toBe(1);
  }, 30000);

  describe('while the workspace is being erased', () => {
    const request = () => db.$executeRaw`INSERT INTO workspace_data_purges ("workspaceId", status, "requestedById", "mediaRoot", "requestedAt", "updatedAt") VALUES (${workspaceId}, 'requested', ${userId}, ${'/tmp/preview-tasks78'}, NOW(), NOW())`;
    const release = () => db.$executeRaw`DELETE FROM workspace_data_purges WHERE "workspaceId" = ${workspaceId}`;

    it('refuses a write at the preflight with no task or audit written', async () => {
      state.client = single as unknown as Record<string, unknown>; state.skipPurgeGuard = false;
      const [tasks, audits] = [await count('tasks'), await count('activity_logs')];
      await request();
      try {
        await expect(performTaskAction(actor, { action: 'task.create', title: 'Must not exist' })).rejects.toMatchObject({ code: 'conflict' });
      } finally { await release(); }
      expect([await count('tasks'), await count('activity_logs')]).toEqual([tasks, audits]);
    }, 30000);

    it('refuses inside the transaction when the purge starts after the preflight', async () => {
      state.client = single as unknown as Record<string, unknown>; state.skipPurgeGuard = true;
      const [tasks, audits] = [await count('tasks'), await count('activity_logs')];
      await request();
      try {
        await expect(performTaskAction(actor, { action: 'task.create', title: 'Must not exist either' })).rejects.toMatchObject({ code: 'conflict' });
      } finally { state.skipPurgeGuard = false; await release(); }
      expect([await count('tasks'), await count('activity_logs')]).toEqual([tasks, audits]);
    }, 30000);

    it('accepts writes again once the purge row is gone', async () => {
      state.client = single as unknown as Record<string, unknown>; state.skipPurgeGuard = false;
      await expect(performTaskAction(actor, { action: 'task.create', title: 'After release' })).resolves.toMatchObject({ ok: true });
    }, 30000);
  });
});
