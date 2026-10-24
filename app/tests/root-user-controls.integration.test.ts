import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const database = vi.hoisted(() => ({ prisma: null as unknown as PrismaClient }));
vi.mock('../src/server/data', () => ({ get prisma() { return database.prisma; } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'root.accountOperationTimeoutMs' ? 300000 : 30000 }));
import { setRootUserDisabled } from '../src/server/root/user-controls';

describe.skipIf(!databaseUrl)('Root account controls against PostgreSQL', () => {
  let client: PrismaClient;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('Integration writes require an isolated loopback _preview database.');
    }
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });
  afterAll(async () => { await client?.$disconnect(); });

  it('rechecks current Root authority and rolls account state and its audit back together', async () => {
    const suffix = randomUUID();
    const actorId = `root_user_probe_${suffix}`;
    const targetId = `root_target_probe_${suffix}`;
    const rollback = new Error('Rollback isolated Root user probe');
    try {
      await client.$transaction(async tx => {
        database.prisma = { $transaction: async (run: (value: typeof tx, options?: unknown) => unknown) => run(tx) } as unknown as PrismaClient;
        await tx.user.create({ data: { id: actorId, email: `${actorId}@example.test`, name: 'Root user probe', passwordHash: 'unusable-test-password', isInstanceOwner: true } });
        await tx.user.create({ data: { id: targetId, email: `${targetId}@example.test`, name: 'Target probe', passwordHash: 'unusable-test-password' } });
        const confirmation = `DISABLE ${targetId}@example.test`;
        await expect(setRootUserDisabled(actorId, targetId, true, confirmation)).resolves.toEqual({ changed: true, sessionsRevoked: 0 });
        expect((await tx.user.findUnique({ where: { id: targetId }, select: { disabledAt: true } }))?.disabledAt).toBeInstanceOf(Date);
        const actions = await tx.$queryRaw<Array<{ action: string }>>`SELECT action FROM root_activities WHERE "actorId" = ${actorId}`;
        expect(actions.map(row => row.action)).toEqual(['root.user_disabled']);
        await tx.user.update({ where: { id: actorId }, data: { isInstanceOwner: false } });
        await expect(setRootUserDisabled(actorId, targetId, false, `ENABLE ${targetId}@example.test`)).rejects.toMatchObject({ code: 'forbidden' });
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    finally { database.prisma = client; }
    expect(await client.user.findUnique({ where: { id: actorId } })).toBeNull();
    expect(await client.user.findUnique({ where: { id: targetId } })).toBeNull();
    const rows = await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE "actorId" = ${actorId}`;
    expect(Number(rows[0]?.count)).toBe(0);
  });
});
