import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';
const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const database = vi.hoisted(() => ({ prisma: null as unknown as PrismaClient }));
vi.mock('../src/server/data', () => ({ get prisma() { return database.prisma; } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'root.directoryPageSize' ? 25 : 200 }));
import { loadRootUsers } from '../src/server/root/users';

describe.skipIf(!databaseUrl)('private user directory against PostgreSQL', () => {
  let client: PrismaClient;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) throw new Error('Integration writes require an isolated loopback _preview database.');
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });
  afterAll(async () => { await client?.$disconnect(); });
  it('searches literal wildcard characters, counts only verified active sessions, and denies demoted actors', async () => {
    const id = `preview_users_${randomUUID()}`;
    const target = `${id}_target`;
    const rollback = new Error('Rollback isolated user directory probe');
    try {
      await client.$transaction(async tx => {
        database.prisma = tx as unknown as PrismaClient;
        await tx.user.create({ data: { id, email: `${id}@example.test`, name: id, passwordHash: 'not-a-login-credential', isInstanceOwner: true } });
        const name = `Literal_%\\ ${id}`;
        await tx.user.create({ data: { id: target, email: `${target}@example.test`, name, passwordHash: 'not-a-login-credential', disabledAt: new Date() } });
        for (const [suffix, pending, expiry] of [['active', null, 60000], ['pending', 'verify', 60000], ['expired', null, -60000]] as const) {
          await tx.session.create({ data: { id: `${id}_${suffix}`, userId: target, tokenHash: randomUUID(), pending, expiresAt: new Date(Date.now() + expiry) } });
        }
        const result = await loadRootUsers(id, { q: name, status: 'disabled' }, 1);
        expect(result.total).toBe(1);
        expect(result.users[0]).toMatchObject({ id: target, _count: { sessions: 1, memberships: 0, passkeys: 0 } });
        expect(JSON.stringify(result)).not.toMatch(/not-a-login-credential|tokenHash|passwordHash|totpSecret/);
        expect((await loadRootUsers(id, { q: name, status: 'active' })).total).toBe(0);
        await tx.user.update({ where: { id }, data: { isInstanceOwner: false } });
        await expect(loadRootUsers(id)).rejects.toMatchObject({ code: 'forbidden' });
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    finally { database.prisma = client; }
    expect(await client.user.count({ where: { id: { in: [id, target] } } })).toBe(0);
    expect(await client.session.count({ where: { userId: target } })).toBe(0);
  });
});
