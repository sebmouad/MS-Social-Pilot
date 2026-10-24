import { createHash } from 'node:crypto';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { emitWorkspaceAlert } from './producers';

const CURSOR = 'notifications.connectionScanCursor';

/** Expiry is a clock transition rather than a provider callback. Scan a bounded,
 * rotating account slice and enqueue once per credential incident. Delivery uses
 * the same current-authority recipient checks as every other notification. */
export async function scanConnectionAlerts(now = new Date()): Promise<number> {
  const [warningDays, batch] = await Promise.all([
    runtimeConfig('notifications.connectionWarningDays') as Promise<number>,
    runtimeConfig('notifications.connectionScanBatch') as Promise<number>,
  ]);
  const horizon = new Date(now.getTime() + warningDays * 86_400_000);
  return prisma.$transaction(async tx => {
    const lock = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${CURSOR}, 0)) AS acquired`;
    if (!lock[0]?.acquired) return 0;
    const saved = await tx.appSetting.findUnique({ where: { key: CURSOR }, select: { value: true } });
    const cursor = typeof saved?.value === 'string' ? saved.value : null;
    const find = (after: boolean, take: number) => tx.socialAccount.findMany({
      where: { ...(cursor ? { id: { [after ? 'gt' : 'lte']: cursor } } : {}),
        OR: [{ invalidatedAt: { not: null } }, { tokenExpiresAt: { lte: horizon } }],
        AND: [{ OR: [{ targets: { some: { enabled: true } } }, { adAccounts: { some: { enabled: true } } }] }],
      },
      orderBy: { id: 'asc' }, take,
      select: { id: true, workspaceId: true },
    });
    let rows = await find(true, batch);
    if (cursor && rows.length < batch) rows = rows.concat(await find(false, batch - rows.length));
    let emitted = 0;
    for (const row of rows) {
      // The snapshot and intent share locks with account edits and workspace erasure.
      const current = await tx.$queryRaw<Array<{ id: string; invalidatedAt: Date | null; tokenExpiresAt: Date | null }>>`
        SELECT a.id, a."invalidatedAt", a."tokenExpiresAt" FROM social_accounts a
        JOIN workspaces w ON w.id = a."workspaceId"
        WHERE a.id = ${row.id} AND a."workspaceId" = ${row.workspaceId} AND w."suspendedAt" IS NULL
          AND NOT EXISTS (SELECT 1 FROM workspace_data_purges p WHERE p."workspaceId" = w.id AND p.status <> 'completed')
          AND (EXISTS (SELECT 1 FROM targets t WHERE t."socialAccountId" = a.id AND t."workspaceId" = w.id AND t.enabled = true)
            OR EXISTS (SELECT 1 FROM ad_accounts d WHERE d."socialAccountId" = a.id AND d."workspaceId" = w.id AND d.enabled = true))
        FOR SHARE OF a, w`;
      const account = current[0];
      if (!account) continue;
      const kind = account.invalidatedAt || account.tokenExpiresAt && account.tokenExpiresAt <= now
        ? 'connection_expired' : account.tokenExpiresAt && account.tokenExpiresAt <= horizon ? 'token_expiring' : null;
      if (!kind) continue;
      const stamp = account.invalidatedAt ?? account.tokenExpiresAt!;
      const incident = createHash('sha256').update(`${account.id}:${stamp.toISOString()}`).digest('hex');
      await emitWorkspaceAlert(tx, { workspaceId: row.workspaceId, accountId: row.id, eventId: `connection_${kind}_${incident}`, kind });
      emitted++;
    }
    if (rows.length) await tx.appSetting.upsert({ where: { key: CURSOR },
      create: { key: CURSOR, value: rows[rows.length - 1].id, encrypted: false, updatedAt: now },
      update: { value: rows[rows.length - 1].id, encrypted: false, updatedAt: now },
    });
    return emitted;
  });
}
