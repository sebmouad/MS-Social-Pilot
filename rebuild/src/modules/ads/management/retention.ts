import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';

/** Caller must hold selected-resource locks for every account before deletion. */
export async function assertAdsOperationsSettled(tx: Prisma.TransactionClient, workspaceId: string, accountIds: readonly string[]) {
  if (!accountIds.length) return;
  const rows = await tx.$queryRaw<Array<{ pending: boolean }>>`SELECT EXISTS (SELECT 1 FROM ads_management_operations WHERE "workspaceId"=${workspaceId} AND "adAccountId"=ANY(${[...accountIds]}::text[]) AND status IN ('pending','uncertain')) AS pending`;
  if (!rows.length || rows[0]?.pending !== false) throw new OperationError('conflict', 'An advertising change still needs review. Check Ads change history and record its verified outcome before deleting related data.');
}
