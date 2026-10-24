import { withAdsCopySnapshot } from '@/modules/ads/server/copy';
import { adsServiceText } from '@/modules/ads/server/copy';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';

/** Caller must hold selected-resource locks for every account before deletion. */
export async function assertAdsOperationsSettled(tx: Prisma.TransactionClient, workspaceId: string, accountIds: readonly string[]) {
  return withAdsCopySnapshot(async () => {
  if (!accountIds.length) return;
  const rows = await tx.$queryRaw<Array<{ pending: boolean }>>`SELECT EXISTS (SELECT 1 FROM ads_management_operations WHERE "workspaceId"=${workspaceId} AND "adAccountId"=ANY(${[...accountIds]}::text[]) AND status IN ('pending','uncertain')) AS pending`;
  if (!rows.length || rows[0]?.pending !== false) throw new OperationError('conflict', await adsServiceText('service031'));

  });
}
