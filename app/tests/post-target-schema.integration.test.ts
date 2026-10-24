import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;

// Requires the full legacy schema in a dedicated synthetic local preview DB.
// This catches omitted client-managed required columns that mocked writes miss.
describe.skipIf(!databaseUrl)('post delivery writes against the legacy schema', () => {
  let prisma: PrismaClient | undefined;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('Integration writes require an isolated loopback _preview database.');
    }
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  it('creates a post destination with the required delivery timestamps without caller-supplied timestamps', async () => {
    const id = `preview_schema_${randomUUID()}`;
    const rollback = new Error('Rollback isolated schema probe');
    try {
      await prisma!.$transaction(async tx => {
        const now = new Date();
        await tx.user.create({ data: { id, email: `${id}@example.test`, name: 'Schema probe', passwordHash: 'not-a-login-credential' } });
        await tx.workspace.create({ data: { id, name: 'Schema probe', slug: id, timezone: 'UTC' } });
        await tx.target.create({ data: { id, workspaceId: id, type: 'page', providerId: id, name: 'Example channel', enabled: true, canPublish: true, createdAt: now } });
        await tx.post.create({ data: { id, workspaceId: id, authorId: id, message: 'Example draft', media: [], status: 'draft', createdAt: now, updatedAt: now, targets: { create: { id, targetId: id, status: 'pending' } } } });
        const rows = await tx.$queryRaw<Array<{ createdAt: Date; updatedAt: Date }>>`SELECT "createdAt", "updatedAt" FROM post_targets WHERE id = ${id}`;
        expect(rows).toHaveLength(1);
        expect(rows[0]!.createdAt).toBeInstanceOf(Date);
        expect(rows[0]!.updatedAt).toBeInstanceOf(Date);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    expect(await prisma!.post.count({ where: { id } })).toBe(0);
    expect(await prisma!.workspace.count({ where: { id } })).toBe(0);
  });
});
