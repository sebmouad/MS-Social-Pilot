import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lockSelectedResources } from '../src/server/platforms/resource-lock';
import { PrismaClient, type Prisma } from '../generated/client';
const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
describe.skipIf(!databaseUrl)('Ads ledger constraints on isolated PostgreSQL', () => {
  let db: PrismaClient;
  beforeAll(() => {
    const u = new URL(databaseUrl!);
    if (process.env.NODE_ENV === 'production' || !['postgres:', 'postgresql:'].includes(u.protocol) || !['localhost','127.0.0.1','[::1]'].includes(u.hostname) || !decodeURIComponent(u.pathname).endsWith('_preview') || ['host','hostaddr','socket'].some(key => u.searchParams.has(key))) throw new Error('Only isolated loopback preview database permitted.');
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });
  afterAll(async () => db?.$disconnect());
  async function fixture(run: (tx: Prisma.TransactionClient, id: string) => Promise<void>) {
    const id = `preview_ads_ledger_${randomUUID().replaceAll('-','')}`;
    const rollback = new Error('Intentional synthetic rollback');
    try { await db.$transaction(async tx => {
      await tx.workspace.create({ data: { id, name: 'Disposable Ads ledger', slug: id, timezone: 'UTC' } });
      await tx.adAccount.create({ data: { id, workspaceId: id, actId: id, name: 'Disposable account', enabled: true } });
      await run(tx, id);
      throw rollback;
    }); } catch (error) { if (error !== rollback) throw error; }
    expect(await db.workspace.count({ where: { id } })).toBe(0);
    const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM ads_management_operations WHERE "workspaceId"=${id}`;
    expect(rows[0]?.count).toBe(BigInt(0));
  }
  async function insert(tx: Prisma.TransactionClient, id: string, row: string, request: string, object: string) {
    return tx.$executeRaw`INSERT INTO ads_management_operations (id,"workspaceId","adAccountId","actorId","requestId","requestHash","operationType","objectType","objectId",params,status) VALUES (${row},${id},${id},${id},${request},${'a'.repeat(64)},'rename','ad',${object},'{}'::jsonb,'pending')`;
  }
  it('refuses recovery during an active dispatch lock while keeping workspace locks independent', async () => {
    const id = `preview_ads_lock_${randomUUID()}`;
    let announce!: () => void, release!: () => void;
    const acquired = new Promise<void>(resolve => { announce = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const holder = db.$transaction(async tx => {
      await lockSelectedResources(tx, id, [{ kind: 'adAccount', id: 'account' }]);
      announce(); await held;
    });
    try {
      await Promise.race([acquired, holder.then(() => { throw new Error('Dispatch lock ended before acquisition'); })]);
      await expect(db.$transaction(tx => lockSelectedResources(tx, id, [{ kind: 'adAccount', id: 'account' }]))).rejects.toMatchObject({ code: 'conflict' });
      await expect(db.$transaction(tx => lockSelectedResources(tx, `${id}_foreign`, [{ kind: 'adAccount', id: 'account' }]))).resolves.toBeUndefined();
    } finally { release(); await holder; }
    await expect(db.$transaction(tx => lockSelectedResources(tx, id, [{ kind: 'adAccount', id: 'account' }]))).resolves.toBeUndefined();
  });

  it('keeps actor request identities unique after a successful operation', async () => fixture(async (tx,id) => {
    await insert(tx,id,`${id}_one`,'request-first','object-one');
    await tx.$executeRaw`UPDATE ads_management_operations SET status='succeeded',"completedAt"=NOW() WHERE id=${`${id}_one`}`;
    await tx.$executeRaw`SAVEPOINT duplicate_request`;
    await expect(insert(tx,id,`${id}_two`,'request-first','object-two')).rejects.toMatchObject({ code: 'P2010' });
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT duplicate_request`;
  }));
  it('holds an uncertain object until explicit attestation and retains the prior receipt', async () => fixture(async (tx,id) => {
    await insert(tx,id,`${id}_one`,'request-first','object-one');
    await tx.$executeRaw`UPDATE ads_management_operations SET status='uncertain',"completedAt"=NOW() WHERE id=${`${id}_one`}`;
    await tx.$executeRaw`SAVEPOINT held_object`;
    await expect(insert(tx,id,`${id}_two`,'request-second','object-one')).rejects.toMatchObject({ code: 'P2010' });
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT held_object`;
    await tx.$executeRaw`UPDATE ads_management_operations SET status='resolved_applied',"resolvedBy"=${id},"resolvedAt"=NOW() WHERE id=${`${id}_one`}`;
    await insert(tx,id,`${id}_two`,'request-second','object-one');
    const rows = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM ads_management_operations WHERE "workspaceId"=${id}`;
    expect(rows[0]?.count).toBe(BigInt(2));
  }));
  it.each(['campaign', 'adset'] as const)('holds an ambiguous %s creation until explicit resolution', async kind => fixture(async (tx, id) => {
    const object = kind === 'campaign' ? '@create-campaign' : '@create-adset:parent-one';
    const operation = `${kind}.create`;
    const create = (suffix: string, request: string) => tx.$executeRaw`INSERT INTO ads_management_operations (id,"workspaceId","adAccountId","actorId","requestId","requestHash","operationType","objectType","objectId",params,status) VALUES (${`${id}_${suffix}`},${id},${id},${id},${request},${'b'.repeat(64)},${operation},${kind},${object},'{}'::jsonb,'pending')`;
    await create('first', 'creation-request-first');
    await tx.$executeRaw`UPDATE ads_management_operations SET status='uncertain',"completedAt"=NOW() WHERE id=${`${id}_first`}`;
    await tx.$executeRaw`SAVEPOINT held_creation`;
    await expect(create('second', 'creation-request-second')).rejects.toMatchObject({ code: 'P2010' });
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT held_creation`;
    await tx.$executeRaw`UPDATE ads_management_operations SET status='resolved_not_applied',"resolvedBy"=${id},"resolvedAt"=NOW() WHERE id=${`${id}_first`}`;
    await create('second', 'creation-request-second');
    const rows = await tx.$queryRaw<Array<{ status: string; remoteId: string | null }>>`SELECT status,"remoteId" FROM ads_management_operations WHERE id=${`${id}_first`}`;
    expect(rows).toEqual([{ status: 'resolved_not_applied', remoteId: null }]);
  }));

});
