import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const database = vi.hoisted(() => ({ prisma: null as unknown as PrismaClient }));
vi.mock('../src/server/data', () => ({ get prisma() { return database.prisma; } }));
import { inboxLastSynced } from '../src/modules/inbox/server/read';

describe.skipIf(!databaseUrl)('Inbox sync timestamps against PostgreSQL', () => {
  let client: PrismaClient;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('Integration writes require an isolated loopback _preview database.');
    }
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    database.prisma = client;
  });
  afterAll(async () => { await client?.$disconnect(); });

  it('reads only sync audits matching both workspace and selected channels', async () => {
    const id = `preview_inbox_${randomUUID()}`;
    const expected = new Date('2026-10-15T12:00:00Z');
    const rollback = new Error('Rollback isolated Inbox probe');
    try {
      await client.$transaction(async tx => {
        database.prisma = tx as unknown as PrismaClient;
        for (const [suffix, workspaceId, targetIds, createdAt] of [
          ['visible', id, [id], expected],
          ['other-workspace', `${id}_other`, [id], new Date('2026-10-16T12:00:00Z')],
          ['other-channel', id, [`${id}_other`], new Date('2026-10-17T12:00:00Z')],
        ] as const) {
          const detail = JSON.stringify({ workspaceId, targetIds });
          await tx.$executeRaw`INSERT INTO root_activities (id, action, detail, "createdAt") VALUES (${`${id}_${suffix}`}, 'inbox.synced', ${detail}::jsonb, ${createdAt})`;
        }
        expect(await inboxLastSynced(id, [id, `${id}_second`])).toEqual(expected);
        expect(await inboxLastSynced(`${id}_missing`, [id])).toBeNull();
        expect(await inboxLastSynced(id, [])).toBeNull();
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    finally { database.prisma = client; }
    const rows = await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE id LIKE ${`${id}%`}`;
    expect(Number(rows[0]?.count)).toBe(0);
  });
});
