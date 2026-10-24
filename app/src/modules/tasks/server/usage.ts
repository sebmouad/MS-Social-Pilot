import { prisma } from '@/server/data';

/** True once the workspace has at least one task; the shell shows the Tasks area only then (design v2, 01 §4). Navigation hint, not an access check. */
export async function workspaceUsesTasks(workspaceId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ one: number }>>`SELECT 1 AS one FROM tasks WHERE "workspaceId" = ${workspaceId} LIMIT 1`;
  return rows.length > 0;
}
