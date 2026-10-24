import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const database = vi.hoisted(() => ({ prisma: null as unknown as PrismaClient }));
vi.mock('../src/server/data', () => ({ get prisma() { return database.prisma; } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'root.activityPageSize' ? 50 : key === 'root.activityCursorMaxCharacters' ? 4096 : 200 }));
import { listRootActivity } from '../src/server/root/activity';

describe.skipIf(!databaseUrl)('private Root audit history against PostgreSQL', () => {
  let client: PrismaClient;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) throw new Error('Integration writes require an isolated loopback _preview database.');
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });
  afterAll(async () => { await client?.$disconnect(); });

  it('paginates tied timestamps both ways, excludes new rows from older pages, filters literally and rolls back', async () => {
    const id = `preview_audit_${randomUUID()}`;
    const rollback = new Error('Rollback isolated audit probe');
    try {
      await client.$transaction(async tx => {
        database.prisma = tx as unknown as PrismaClient;
        await tx.user.create({ data: { id, email: `${id}@example.test`, name: 'Audit probe', passwordHash: 'unusable-test-password', isInstanceOwner: true } });
        const at = new Date('2026-10-16T12:00:00Z');
        const insert = async (suffix: string, workspaceId = id, action = `probe.${id}`, createdAt = at) => {
          const detail = JSON.stringify({ workspaceId, published: 3, token: 'NEVER EXPOSE', message: `private_${id}` });
          await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`${id}_${suffix}`}, ${id}, ${action}, ${detail}::jsonb, ${createdAt.toISOString()}::timestamp)`;
        };
        for (const suffix of ['a', 'b', 'c', 'd', 'e']) await insert(suffix);
        await insert('foreign', `${id}_other`);
        await insert('midnight', id, `${id}.boundary`, new Date('2026-10-16T00:05:00Z'));
        await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Honolulu'`;
        const input = { q: `probe.${id}`, workspaceId: id, from: '2026-10-16', to: '2026-10-16', limit: 2 };
        const first = await listRootActivity(id, input);
        expect(first.items.map(row => row.id)).toEqual([`${id}_e`, `${id}_d`]);
        await insert('z');
        const second = await listRootActivity(id, { ...input, cursor: first.olderCursor! });
        expect(second.items.map(row => row.id)).toEqual([`${id}_c`, `${id}_b`]);
        const last = await listRootActivity(id, { ...input, cursor: second.olderCursor! });
        expect(last.items.map(row => row.id)).toEqual([`${id}_a`]);
        expect(last.olderCursor).toBeNull();
        const previous = await listRootActivity(id, { ...input, cursor: second.newerCursor! });
        expect(previous.items.map(row => row.id)).toEqual([`${id}_e`, `${id}_d`]);
        const latest = await listRootActivity(id, { ...input, cursor: previous.newerCursor! });
        expect(latest.items.map(row => row.id)).toEqual([`${id}_z`]);
        expect(latest.newerCursor).toBeNull();
        expect(JSON.stringify(first)).not.toMatch(/NEVER EXPOSE|private_|token/);
        expect((await listRootActivity(id, { q: `private_${id}` })).items).toEqual([]);
        expect((await listRootActivity(id, { workspaceId: id, q: `${id}.boundary`, from: '2026-10-16', to: '2026-10-16' })).items.map(row => row.id)).toEqual([`${id}_midnight`]);
        expect((await listRootActivity(id, { ...input, from: '2026-10-17', to: '2026-10-17' })).items).toEqual([]);
        expect((await listRootActivity(id, { ...input, from: '9999-12-31', to: '9999-12-31' })).items).toEqual([]);
        await insert('literal', id, 'probe.50%_\\');
        await insert('wildcard', id, 'probe.500abc');
        expect((await listRootActivity(id, { workspaceId: id, q: '50%_\\' })).items.map(row => row.id)).toEqual([`${id}_literal`]);
        expect((await listRootActivity(id, { workspaceId: id, q: `${id}@example.test` })).items.length).toBe(9);
        await tx.user.update({ where: { id }, data: { isInstanceOwner: false } });
        await expect(listRootActivity(id, {})).rejects.toMatchObject({ code: 'forbidden' });
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    finally { database.prisma = client; }
    expect(await client.user.findUnique({ where: { id } })).toBeNull();
    const rows = await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE "actorId" = ${id}`;
    expect(Number(rows[0]?.count)).toBe(0);
  });
});
