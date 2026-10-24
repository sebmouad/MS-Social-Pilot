import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient, Prisma } from '../generated/client';
const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
describe.skipIf(!databaseUrl)('Tasks comments and erasure guards on isolated PostgreSQL', () => {
  let db: PrismaClient;
  beforeAll(() => {
    const u = new URL(databaseUrl!);
    if (process.env.NODE_ENV === 'production' || !['postgres:', 'postgresql:'].includes(u.protocol) || !['localhost','127.0.0.1','[::1]'].includes(u.hostname) || !decodeURIComponent(u.pathname).endsWith('_preview') || ['host','hostaddr','socket'].some(k => u.searchParams.has(k))) throw new Error('Only isolated loopback preview database permitted.');
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });
  afterAll(async () => db?.$disconnect());
  async function fixture(run: (tx: Prisma.TransactionClient, id: string) => Promise<void>) {
    const id = `preview_tasks76_${randomUUID().replaceAll('-','')}`, rollback = new Error('Intentional synthetic rollback');
    try { await db.$transaction(async tx => {
      for (const workspaceId of [id, `${id}_foreign`]) await tx.workspace.create({ data: { id: workspaceId, name: 'Disposable Tasks schema', slug: workspaceId, timezone: 'UTC' } });
      await tx.user.create({ data: { id, name: 'Disposable Tasks author', email: `${id}@example.test`, passwordHash: 'unusable-synthetic-password' } });
      await tx.$executeRaw`INSERT INTO tasks (id,"workspaceId",title,status,"createdAt","updatedAt") VALUES (${id},${id},'Disposable task','todo',NOW(),NOW())`;
      await run(tx,id); throw rollback;
    }); } catch(error) { if(error !== rollback) throw error; }
    expect(await db.workspace.count({ where: { id: { in: [id,`${id}_foreign`] } } })).toBe(0);
    expect(await db.user.count({ where: { id } })).toBe(0);
  }
  const comment = (tx: Prisma.TransactionClient, id: string, workspaceId = id, body = 'Synthetic comment') => tx.$executeRaw`INSERT INTO task_comments (id,"taskId","workspaceId","authorId",body) VALUES (${`${id}_comment`},${id},${workspaceId},${id},${body})`;
  it('makes cross-workspace comments impossible at the database boundary', async () => fixture(async (tx,id) => {
    await tx.$executeRaw`SAVEPOINT foreign_comment`;
    await expect(comment(tx,id,`${id}_foreign`)).rejects.toMatchObject({ code: 'P2010', meta: { code: '23503' } });
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT foreign_comment`;
    await comment(tx,id);
  }));
  it.each(['', ' '.repeat(3), 'x'.repeat(20001)])('refuses invalid comment body at the database boundary', async body => fixture(async (tx,id) => {
    await tx.$executeRaw`SAVEPOINT invalid_body`;
    await expect(comment(tx,id,id,body)).rejects.toMatchObject({ code: 'P2010', meta: { code: '23514' } });
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT invalid_body`;
  }));
  it('retains comments with a cleared author, then cascades them when the task is removed', async () => fixture(async (tx,id) => {
    await comment(tx,id);
    await tx.user.delete({ where: { id } });
    expect(await tx.$queryRaw`SELECT "authorId",body FROM task_comments WHERE id=${`${id}_comment`}`).toEqual([{ authorId: null, body: 'Synthetic comment' }]);
    await tx.$executeRaw`DELETE FROM tasks WHERE id=${id}`;
    expect(await tx.$queryRaw`SELECT id FROM task_comments WHERE "workspaceId"=${id}`).toEqual([]);
  }));
  it('blocks late task/comment writes throughout erasure while allowing erasure deletes', async () => fixture(async (tx,id) => {
    await comment(tx,id);
    await tx.$executeRaw`INSERT INTO workspace_data_purges ("workspaceId",status,"requestedById","mediaRoot","updatedAt") VALUES (${id},'requested',${id},'/synthetic/tasks76',NOW())`;
    for (const query of [Prisma.sql`UPDATE tasks SET title='Late write' WHERE id=${id}`, Prisma.sql`UPDATE task_comments SET body='Late comment' WHERE "workspaceId"=${id}`]) {
      await tx.$executeRaw`SAVEPOINT blocked_write`;
      await expect(tx.$executeRaw(query)).rejects.toMatchObject({ code: 'P2010', meta: { code: '55000' } });
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT blocked_write`;
    }
    await tx.$executeRaw`DELETE FROM task_comments WHERE "workspaceId"=${id}`;
    await tx.$executeRaw`UPDATE workspace_data_purges SET status='completed' WHERE "workspaceId"=${id}`;
    await comment(tx,id);
  }));
  it('installs the shared gate on every directly workspace-owned application table', async () => {
    const rows = await db.$queryRaw<Array<{ table_name: string }>>`SELECT DISTINCT c.relname AS table_name FROM pg_constraint fk JOIN pg_class c ON c.oid=fk.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE fk.contype='f' AND fk.confrelid='public.workspaces'::regclass AND n.nspname='public' AND c.relkind='r' AND c.relname NOT IN ('memberships','workspace_data_purges') AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='rebuild_workspace_purge_write_gate' AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND t.tgfoid='public.rebuild_reject_purging_workspace_write()'::regprocedure)`;
    expect(rows).toEqual([]);
  });
});
