import { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import type { AdsObjectType, AdsNeutralOperation } from '../management/types';

export type StoredAdObject = { adAccountId: string; level: AdsObjectType; objectId: string; name: string | null; parentId: string | null; status: string | null; fetchedAt: Date };
type Store = Pick<typeof prisma, '$executeRaw' | '$queryRaw'>;
export async function saveAdObject(db: Store, item: StoredAdObject) {
  await db.$executeRaw`INSERT INTO ads_objects ("adAccountId", level, "objectId", name, "parentId", status, "fetchedAt")
    VALUES (${item.adAccountId}, ${item.level}, ${item.objectId}, ${item.name}, ${item.parentId}, ${item.status}, ${item.fetchedAt})
    ON CONFLICT ("adAccountId", level, "objectId") DO UPDATE SET name = EXCLUDED.name,
    "parentId" = EXCLUDED."parentId", status = EXCLUDED.status, "fetchedAt" = EXCLUDED."fetchedAt"
    WHERE ads_objects."fetchedAt" <= EXCLUDED."fetchedAt"`;
}
/** Call only with account ids from the service's current authorized account query. */
export async function listStoredAdObjects(accountIds: readonly string[], levels: readonly string[], limit: number, db: Store = prisma) {
  if (!accountIds.length || !levels.length) return [];
  return db.$queryRaw<StoredAdObject[]>(Prisma.sql`SELECT * FROM ads_objects WHERE status IS DISTINCT FROM 'deleted' AND "adAccountId" IN (${Prisma.join([...accountIds])}) AND level IN (${Prisma.join([...levels])}) ORDER BY "adAccountId", level, "objectId" LIMIT ${limit}`);
}
export async function recordAdObjectChange(db: Store, accountId: string, operation: AdsNeutralOperation, remoteId: string | null, now = new Date()) {
  if (operation.type === 'creative.create') return;
  if (operation.type === 'campaign.create' || operation.type === 'adset.create' || operation.type === 'ad.create') {
    if (!remoteId) throw new Error('Missing created object identity');
    await saveAdObject(db, { adAccountId: accountId, level: operation.objectType, objectId: remoteId, name: operation.name, parentId: 'parentId' in operation ? operation.parentId : null, status: 'paused', fetchedAt: now });
  } else if (operation.type === 'delete') {
    await saveAdObject(db, { adAccountId: accountId, level: operation.objectType, objectId: operation.objectId, name: null, parentId: null, status: 'deleted', fetchedAt: now });
  } else if (operation.type === 'rename') {
    await db.$executeRaw`UPDATE ads_objects SET name = ${operation.name}, "fetchedAt" = ${now} WHERE "adAccountId" = ${accountId} AND level = ${operation.objectType} AND "objectId" = ${operation.objectId}`;
  } else if (operation.type === 'status.set') {
    await db.$executeRaw`UPDATE ads_objects SET status = ${operation.status}, "fetchedAt" = ${now} WHERE "adAccountId" = ${accountId} AND level = ${operation.objectType} AND "objectId" = ${operation.objectId}`;
  }
}

export async function findStoredAdObject(accountId: string, level: AdsObjectType, objectId: string, db: Store = prisma): Promise<StoredAdObject | null> {
  const rows = await db.$queryRaw<StoredAdObject[]>`SELECT * FROM ads_objects WHERE status IS DISTINCT FROM 'deleted' AND "adAccountId" = ${accountId} AND level = ${level} AND "objectId" = ${objectId}`;
  return rows[0] ?? null;
}
