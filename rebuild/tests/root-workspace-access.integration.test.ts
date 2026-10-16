import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const database = vi.hoisted(() => ({ prisma: null as unknown as PrismaClient }));
vi.mock('../src/server/data', () => ({ get prisma() { return database.prisma; } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'data.workspaceOperationTimeoutMs' ? 300000 : 30000 }));
import { setRootWorkspaceAccess } from '../src/server/root/workspace-access';
import { workspaceAccessConfirmation } from '../src/lib/root-workspace-access';
import { withWorkspaceOperation } from '../src/server/data-control/guard';

describe.skipIf(!databaseUrl)('Root workspace access against PostgreSQL', () => {
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

  it('suspends and restores operations, audits both changes, and rolls every probe record back', async () => {
    const id = `preview_access_${randomUUID()}`;
    const rollback = new Error('Rollback isolated workspace access probe');
    try {
      await client.$transaction(async tx => {
        // Reuse this rollback-only transaction for both services; no nested transaction.
        database.prisma = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) } as unknown as PrismaClient;
        await tx.user.create({ data: { id, email: `${id}@example.test`, name: 'Access probe', passwordHash: 'unusable-test-password', isInstanceOwner: true } });
        await tx.workspace.create({ data: { id, slug: id, name: 'Access probe', timezone: 'UTC' } });
        await expect(setRootWorkspaceAccess(id, id, true, workspaceAccessConfirmation(id, true))).resolves.toMatchObject({ suspended: true, changed: true });
        const read = () => tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`SELECT "suspendedAt" FROM workspaces WHERE id = ${id}`;
        expect((await read())[0]?.suspendedAt).toBeInstanceOf(Date);
        const sideEffect = vi.fn(async () => 'allowed');
        await expect(withWorkspaceOperation(id, sideEffect)).rejects.toMatchObject({ code: 'forbidden' });
        expect(sideEffect).not.toHaveBeenCalled();
        await expect(setRootWorkspaceAccess(id, id, false, workspaceAccessConfirmation(id, false))).resolves.toMatchObject({ suspended: false, changed: true });
        expect((await read())[0]?.suspendedAt).toBeNull();
        await expect(withWorkspaceOperation(id, sideEffect)).resolves.toBe('allowed');
        const audit = await tx.$queryRaw<Array<{ action: string }>>`SELECT action FROM root_activities WHERE "actorId" = ${id} ORDER BY "createdAt", action`;
        expect(audit.map(row => row.action).sort()).toEqual(['root.workspace_restored', 'root.workspace_suspended']);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    finally { database.prisma = client; }
    expect(await client.workspace.findUnique({ where: { id } })).toBeNull();
    expect(await client.user.findUnique({ where: { id } })).toBeNull();
    const rows = await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE "actorId" = ${id}`;
    expect(Number(rows[0]?.count)).toBe(0);
  });
});
