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
