import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient, Prisma } from '../generated/client';

// The erasure function under test only receives a transaction client; stub the singleton and sibling guards it imports.
vi.mock('../src/server/data', () => ({ prisma: {} }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: vi.fn() }));
vi.mock('../src/modules/publishing/server/guard', () => ({ assertPublishingTargetsSettled: vi.fn() }));
vi.mock('../src/modules/inbox/server/comment-guard', () => ({ assertInboxDeletionsSettled: vi.fn() }));
vi.mock('../src/server/data-control/storage', () => ({ canonicalMediaRoot: vi.fn(), removeWorkspaceStorage: vi.fn(), validateWorkspaceId: vi.fn() }));

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;

describe.skipIf(!databaseUrl)('feed-sourced post erasure on isolated PostgreSQL', () => {
  let db: PrismaClient;
  beforeAll(() => {
    const u = new URL(databaseUrl!);
    if (process.env.NODE_ENV === 'production' || !['postgres:', 'postgresql:'].includes(u.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || !decodeURIComponent(u.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(k => u.searchParams.has(k))) throw new Error('Only isolated loopback preview database permitted.');
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });
  afterAll(async () => db?.$disconnect());

  async function fixture(run: (tx: Prisma.TransactionClient, id: string) => Promise<void>) {
    const id = `preview_feederase_${randomUUID().replaceAll('-', '')}`, rollback = new Error('Intentional synthetic rollback');
    try {
      await db.$transaction(async tx => {
        for (const workspaceId of [id, `${id}_foreign`]) await tx.workspace.create({ data: { id: workspaceId, name: 'Disposable feed erasure', slug: workspaceId, timezone: 'UTC' } });
        await tx.user.create({ data: { id, name: 'Disposable feed author', email: `${id}@example.test`, passwordHash: 'unusable-synthetic-password' } });
        for (const [workspaceId, suffix] of [[id, 'own'], [`${id}_foreign`, 'foreign']] as const) {
          await tx.$executeRaw`INSERT INTO feed_sources (id,"workspaceId",name,url,kind,enabled,"messageTemplate","targetIds",hashtags,"ingestFrom","createdAt","updatedAt") VALUES (${`${id}_src_${suffix}`},${workspaceId},'Synthetic feed','https://example.test/feed.xml','rss',true,'{{title}}','[]'::jsonb,'',NOW(),NOW(),NOW())`;
          await tx.$executeRaw`INSERT INTO feed_items (id,"feedSourceId",guid,"createdAt") VALUES (${`${id}_item_${suffix}`},${`${id}_src_${suffix}`},${`guid-${suffix}`},NOW())`;
        }
        const post = (name: string, workspaceId: string, item: string) => tx.$executeRaw`INSERT INTO posts (id,"workspaceId","authorId",message,status,"sourceFeedItemId","createdAt","updatedAt") VALUES (${`${id}_${name}`},${workspaceId},${id},'Synthetic feed post','draft'::"PostStatus",${`${id}_item_${item}`},NOW(),NOW())`;
        await post('own_from_own', id, 'own');
        await post('own_from_foreign', id, 'foreign');
        await post('foreign_from_own', `${id}_foreign`, 'own');
        await post('foreign_from_foreign', `${id}_foreign`, 'foreign');
        await run(tx, id);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    expect(await db.workspace.count({ where: { id: { in: [id, `${id}_foreign`] } } })).toBe(0);
    expect(await db.user.count({ where: { id } })).toBe(0);
  }

  it('erases feed-linked posts under the purge gate and keeps everything outside the workspace', async () => fixture(async (tx, id) => {
    await tx.$executeRaw`INSERT INTO workspace_data_purges ("workspaceId",status,"requestedById","mediaRoot","updatedAt") VALUES (${id},'requested',${id},'/synthetic/feederase',NOW())`;

    // Control: the old order (feed item first) lets ON DELETE SET NULL touch a post that still exists, which the gate refuses.
    await tx.$executeRaw`SAVEPOINT item_first`;
    await expect(tx.$executeRaw`DELETE FROM feed_items WHERE id = ${`${id}_item_own`}`).rejects.toMatchObject({ code: 'P2010', meta: { code: '55000' } });
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT item_first`;

    const { deleteWorkspaceDatabaseRows } = await import('../src/server/data-control');
    await deleteWorkspaceDatabaseRows(tx, id);

    expect(await tx.$queryRaw`SELECT id FROM posts WHERE "workspaceId" = ${id}`).toEqual([]);
    expect(await tx.$queryRaw`SELECT id FROM feed_sources WHERE "workspaceId" = ${id}`).toEqual([]);
    expect(await tx.$queryRaw`SELECT id FROM feed_items WHERE id = ${`${id}_item_own`}`).toEqual([]);
    // The foreign workspace keeps its source, item and posts; only a link into the erased workspace's item is cleared.
    expect(await tx.$queryRaw`SELECT id FROM feed_sources WHERE id = ${`${id}_src_foreign`}`).toHaveLength(1);
    expect(await tx.$queryRaw`SELECT id FROM feed_items WHERE id = ${`${id}_item_foreign`}`).toHaveLength(1);
    const foreign = await tx.$queryRaw<Array<{ id: string; sourceFeedItemId: string | null }>>`SELECT id,"sourceFeedItemId" FROM posts WHERE "workspaceId" = ${`${id}_foreign`} ORDER BY id`;
    expect(foreign).toEqual([
      { id: `${id}_foreign_from_foreign`, sourceFeedItemId: `${id}_item_foreign` },
      { id: `${id}_foreign_from_own`, sourceFeedItemId: null },
    ]);
  }));
});
