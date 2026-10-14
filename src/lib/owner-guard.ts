import type { Prisma } from '@prisma/client';

/** Share one transaction lock across every path that can remove an owner. */
export async function lockWorkspaceOwners(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(1705094, hashtext(${workspaceId}))`;
}
