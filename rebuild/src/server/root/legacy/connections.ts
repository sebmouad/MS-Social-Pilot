import { OperationError } from '@/lib/operation-error';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { connectionState, type ConnectionState } from '@/lib/connection-status';
import { platformModule } from '@/platforms';
import { assertRootActor, invalid, redact } from './authz';
import { legacySetting, rootResultLimit } from './policy';

const filterSchema = z.object({
  q: z.string().trim().max(2000).optional(),
  provider: z.string().trim().min(1).max(64).regex(/^[a-z0-9_-]+$/).optional(),
  state: z.enum(['connected', 'expired', 'revoked']).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
}).strict();

/**
 * Every provider connection in every workspace, read-only and provider-neutral:
 * the platform name comes from the installed module manifest. Tokens, refresh
 * tokens and scopes are never returned; only a scope count and expiry.
 */
export async function listRootConnections(actorId: string, input: unknown = {}, resultCap?: number) {
  await assertRootActor(prisma, actorId);
  const parsed = filterSchema.safeParse(input);
  const max = await legacySetting('root.legacy.searchMaxCharacters');
  if (!parsed.success || (parsed.data.q?.length ?? 0) > max) throw invalid('Use a shorter search and a valid filter.');
  const { q, provider, state, page = 1 } = parsed.data;
  const size = rootResultLimit(await legacySetting('root.legacy.privilegePageSize'), resultCap);
  const now = new Date();
  const stateWhere = state === 'revoked' ? { invalidatedAt: { not: null } }
    : state === 'expired' ? { invalidatedAt: null, tokenExpiresAt: { lte: now } }
    : state === 'connected' ? { invalidatedAt: null, OR: [{ tokenExpiresAt: null }, { tokenExpiresAt: { gt: now } }] }
    : {};
  const search = q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { workspace: { name: { contains: q, mode: 'insensitive' as const } } }] } : {};
  const where = { ...(provider ? { provider } : {}), AND: [stateWhere, search] };
  const [total, rows] = await Promise.all([
    prisma.socialAccount.count({ where }),
    prisma.socialAccount.findMany({
      where, orderBy: [{ provider: 'asc' }, { name: 'asc' }, { id: 'asc' }], skip: (page - 1) * size, take: size,
      select: { id: true, provider: true, name: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true, invalidReason: true, createdAt: true, workspace: { select: { id: true, name: true } }, targets: { select: { enabled: true } } },
    }),
  ]);
  const items = rows.map(row => {
    const status: ConnectionState = connectionState(row, now);
    return {
      id: row.id, provider: row.provider, platformName: platformModule(row.provider)?.name ?? row.provider, installed: Boolean(platformModule(row.provider)),
      name: row.name, workspace: row.workspace, state: status,
      tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null, invalidatedAt: row.invalidatedAt?.toISOString() ?? null,
      invalidReason: redact(row.invalidReason, 200),
      scopeCount: row.scopes.split(/[,\s]+/).filter(Boolean).length,
      channels: { selected: row.targets.filter(target => target.enabled).length, discovered: row.targets.length },
      createdAt: row.createdAt.toISOString(),
    };
  });
  return { items, page, pageSize: size, total, limits: { searchMaxCharacters: max } };
}

export const rootDisconnectConfirmation = (socialAccountId: string) => `DISCONNECT CONNECTION ${socialAccountId}`;
export const rootDisconnectDeleteConfirmation = (socialAccountId: string) => `DELETE CONNECTION DATA ${socialAccountId}`;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;

/** What delete mode would remove, as local row counts. Read-only; nothing is changed and nothing is asked of the platform. */
export async function previewRootConnectionDeletion(actorId: string, socialAccountId: string) {
  await assertRootActor(prisma, actorId);
  if (!validId(socialAccountId)) throw new OperationError('invalid_request', 'Choose a connection.');
  const { previewSocialAccountDeletionAsRoot } = await import('@/server/connection-mutations');
  const { workspaceId, counts } = await previewSocialAccountDeletionAsRoot(socialAccountId);
  return { socialAccountId, workspaceId, counts, providerRevoked: false as const };
}

/**
 * Root disconnect of one workspace connection. Retain mode (default) invalidates local credentials and disables its
 * channels and ad accounts while every post, message and metric stays. Delete mode also removes the related local
 * records through the same transactional service the workspace uses, with its own exact confirmation, and refuses
 * while posts are still scheduled at the provider. Nothing is revoked at the provider; the result says so.
 */
export async function disconnectRootConnection(actorId: string, socialAccountId: string, confirmation: string, mode: 'retain' | 'delete' = 'retain') {
  if (!validId(socialAccountId)) throw new OperationError('invalid_request', 'Choose a connection.');
  if (mode !== 'retain' && mode !== 'delete') throw new OperationError('invalid_request', 'Choose retain or delete.');
  const expected = mode === 'delete' ? rootDisconnectDeleteConfirmation(socialAccountId) : rootDisconnectConfirmation(socialAccountId);
  if (confirmation !== expected) throw new OperationError('invalid_request', 'Enter the exact confirmation shown.');
  const owner = await prisma.socialAccount.findUnique({ where: { id: socialAccountId }, select: { workspaceId: true } });
  if (!owner) throw new OperationError('not_found', 'Connection not found.');
  const { disconnectSocialAccount } = await import('@/server/connection-mutations');
  const result = await disconnectSocialAccount({ userId: actorId, workspaceId: owner.workspaceId }, socialAccountId, mode, mode === 'delete' ? 'DELETE' : undefined, async tx => {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { isInstanceOwner: true, disabledAt: true } });
    if (!actor?.isInstanceOwner || actor.disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
  });
  return { ...result, workspaceId: owner.workspaceId, providerRevoked: false as const };
}
