import { prisma } from '@/server/data';

const CODE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DATA_DELETION_ACTION = 'platform.data_deletion';

export type DeletionStatus = { state: 'invalid' } | { state: 'unknown' } | { state: 'completed'; connections: number; completedAt: Date };

/**
 * Public, read-only answer for a provider data-deletion confirmation code. Only counts and the time are
 * disclosed; no workspace, person or channel identity leaves this function.
 */
export async function deletionRequestStatus(code: string | null | undefined): Promise<DeletionStatus> {
  if (!code || !CODE.test(code)) return { state: 'invalid' };
  const rows = await prisma.$queryRaw<Array<{ createdAt: Date }>>`SELECT "createdAt" FROM activity_logs WHERE action = ${DATA_DELETION_ACTION} AND detail->>'confirmationCode' = ${code.toLowerCase()} ORDER BY "createdAt" ASC`;
  if (!rows.length) return { state: 'unknown' };
  return { state: 'completed', connections: rows.length, completedAt: rows[rows.length - 1]!.createdAt };
}
