import { z } from 'zod';
import { prisma } from '@/server/data';
import { PLATFORM_HOSTS } from '@/server/platforms';
import type { PlatformHost } from '@/server/platforms/host';
import { lockSelectedResources } from '@/server/platforms/resource-lock';
import { decryptSecret, encryptSecret } from '@/server/secret-crypto';
import { OperationError } from '@/lib/operation-error';
import { assertRootActor, lockRootActor } from './authz';
import { legacySetting } from './policy';
import { writeRootAudit } from './audit';

export const rootRefreshConfirmation = (id: string) => `REFRESH CONNECTION ${id}`;
export const rootRefreshInput = z.object({
  socialAccountId: z.string().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/),
  confirmation: z.string().max(400),
}).strict();
export type ConnectionRefreshOutcome = 'renewed' | 'not_renewable' | 'failed';

/** Private installation action; credentials never leave the host/service boundary. */
export async function refreshRootConnection(actorId: string, input: unknown) {
  await assertRootActor(prisma, actorId);
  const parsed = rootRefreshInput.safeParse(input);
  if (!parsed.success || parsed.data.confirmation !== rootRefreshConfirmation(parsed.data.socialAccountId)) {
    throw new OperationError('invalid_request', 'Enter the exact connection refresh confirmation.');
  }
  const { socialAccountId } = parsed.data;
  const owner = await prisma.socialAccount.findUnique({ where: { id: socialAccountId }, select: { workspaceId: true } });
  if (!owner) throw new OperationError('not_found', 'Connection not found.');
  const [timeout, grace, maxWait] = await Promise.all([
    legacySetting('root.legacy.connectionRefreshTimeoutMs'), legacySetting('root.legacy.connectionRefreshGraceMs'), legacySetting('root.legacy.connectionRefreshMaxWaitMs'),
  ]);
  return prisma.$transaction(async tx => {
    const workspaces = await tx.$queryRaw<Array<{ id: string; suspendedAt: Date | null }>>`SELECT id, "suspendedAt" FROM workspaces WHERE id = ${owner.workspaceId} FOR SHARE`;
    if (!workspaces.length) throw new OperationError('not_found', 'Workspace not found.');
    if (workspaces[0]!.suspendedAt) throw new OperationError('forbidden', 'This workspace is suspended.');
    const purge = await tx.workspaceDataPurge.findUnique({ where: { workspaceId: owner.workspaceId }, select: { status: true } });
    if (purge && purge.status !== 'completed') throw new OperationError('conflict', 'Workspace data deletion is in progress.');
    await lockRootActor(tx, actorId);
    const resources = await tx.socialAccount.findFirst({ where: { id: socialAccountId, workspaceId: owner.workspaceId }, select: { targets: { select: { id: true } }, adAccounts: { select: { id: true } } } });
    if (!resources) throw new OperationError('not_found', 'Connection not found.');
    // Match collectors, disconnect and reconnection before locking the shared credential row.
    await lockSelectedResources(tx, owner.workspaceId, [
      ...resources.targets.map(row => ({ kind: 'target' as const, id: row.id })),
      ...resources.adAccounts.map(row => ({ kind: 'adAccount' as const, id: row.id })),
    ]);
    await tx.$queryRaw`SELECT id FROM social_accounts WHERE id = ${socialAccountId} AND "workspaceId" = ${owner.workspaceId} FOR UPDATE`;
    const account = await tx.socialAccount.findFirst({ where: { id: socialAccountId, workspaceId: owner.workspaceId }, select: { provider: true, accessToken: true, refreshToken: true, invalidatedAt: true } });
    if (!account) throw new OperationError('not_found', 'Connection not found.');
    const host = Object.hasOwn(PLATFORM_HOSTS, account.provider) ? (PLATFORM_HOSTS as Readonly<Record<string, PlatformHost | undefined>>)[account.provider] : undefined;
    let outcome: ConnectionRefreshOutcome = 'not_renewable';
    let expiresAt: Date | null = null;
    let renewed: Awaited<ReturnType<NonNullable<PlatformHost['connection']['renewToken']>>> = null;
    if (!account.invalidatedAt && host?.connection.renewToken) {
      try {
        const signal = AbortSignal.timeout(timeout);
        renewed = await host.connection.renewToken({ accessToken: decryptSecret(account.accessToken), refreshToken: account.refreshToken ? decryptSecret(account.refreshToken) : null, signal });
        signal.throwIfAborted();
        if (renewed) {
          if (!renewed.accessToken || renewed.expiresAt !== null && (!Number.isFinite(renewed.expiresAt.getTime()) || renewed.expiresAt <= new Date())) throw new Error('Invalid renewal result');
          outcome = 'renewed';
        }
      } catch {
        // Provider errors may contain tokens or request URLs. Persist no raw error text.
        outcome = 'failed';
        renewed = null;
      }
    }
    if (renewed) {
      expiresAt = renewed.expiresAt;
      const saved = await tx.socialAccount.updateMany({ where: { id: socialAccountId, workspaceId: owner.workspaceId, invalidatedAt: null }, data: {
        accessToken: encryptSecret(renewed.accessToken), tokenExpiresAt: expiresAt,
        ...(renewed.refreshToken !== undefined ? { refreshToken: renewed.refreshToken === null ? null : encryptSecret(renewed.refreshToken) } : {}),
      } });
      if (saved.count !== 1) throw new OperationError('conflict', 'The connection changed. Reload before repeating it.');
    }
    const receipt = { socialAccountId, workspaceId: owner.workspaceId, outcome, tokenExpiresAt: expiresAt?.toISOString() ?? null };
    await writeRootAudit(tx, actorId, `root.connection_refresh.${outcome}`, receipt);
    return receipt;
  }, { timeout: timeout + grace, maxWait });
}
