import { prisma } from '@/server/data';
import { selectedResourceConnectionWhere } from '@/server/platforms/resource-visibility';
import { connectionState, type ConnectionState } from '@/lib/connection-status';
import { platformModule } from '@/platforms';

export type ShellChannel = { id: string; name: string; pictureUrl: string | null; platformName: string | null; health: ConnectionState };

/**
 * Selected channels the member may see, for the sidebar scope list. Only enabled targets of selected
 * connections are listed; `scopeIds` is the member's own channel limit (undefined = every channel).
 * Health uses the shared connection state; provider rules stay in the platform modules.
 */
export async function shellChannels(workspaceId: string, scopeIds: readonly string[] | undefined, limit: number, now = new Date()): Promise<ShellChannel[]> {
  const rows = await prisma.target.findMany({
    where: {
      workspaceId,
      enabled: true,
      socialAccount: { is: await selectedResourceConnectionWhere(workspaceId) },
      ...(scopeIds === undefined ? {} : { id: { in: [...scopeIds] } }),
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true, name: true, pictureUrl: true, socialAccount: { select: { provider: true, invalidatedAt: true, tokenExpiresAt: true } } },
  });
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    pictureUrl: row.pictureUrl ?? null,
    platformName: row.socialAccount?.provider ? platformModule(row.socialAccount.provider)?.name ?? null : null,
    health: row.socialAccount ? connectionState(row.socialAccount, now) : 'revoked',
  }));
}
