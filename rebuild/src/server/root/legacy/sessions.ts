import { z } from 'zod';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { assertRootActor, invalid, lockRootActor } from './authz';
import { writeRootAudit } from './audit';
import { legacySetting, rootResultLimit, rootTransaction } from './policy';

const filterSchema = z.object({ q: z.string().trim().max(2000).optional() }).strict();

export const sessionSignOutConfirmation = (sessionId: string) => `SIGN OUT SESSION ${sessionId}`;

/**
 * Installation-wide unexpired browser sessions with their account. Token hashes,
 * pending challenges and credentials are never returned. Bounded by the Root
 * lifecycle list limit (limit + 1 read) and labelled truncated when cut off.
 */
export async function listRootSessions(actorId: string, input: unknown = {}, resultCap?: number, currentSessionId?: string | null) {
  await assertRootActor(prisma, actorId);
  const parsed = filterSchema.safeParse(input);
  const max = await legacySetting('root.legacy.searchMaxCharacters');
  if (!parsed.success || (parsed.data.q?.length ?? 0) > max) throw invalid('Use a shorter search.');
  const limit = rootResultLimit(await legacySetting('root.legacy.lifecycleListLimit'), resultCap);
  const q = parsed.data.q || undefined;
  const rows = await prisma.session.findMany({
    where: { expiresAt: { gt: new Date() }, ...(q ? { user: { OR: [{ email: { contains: q, mode: 'insensitive' as const } }, { name: { contains: q, mode: 'insensitive' as const } }] } } : {}) },
    orderBy: [{ expiresAt: 'desc' }, { id: 'asc' }],
    take: limit + 1,
    select: { id: true, expiresAt: true, pending: true, user: { select: { id: true, email: true, name: true, disabledAt: true, isInstanceOwner: true } } },
  });
  const items = rows.slice(0, limit).map(row => ({
    id: row.id, expiresAt: row.expiresAt.toISOString(), verified: !row.pending, current: Boolean(currentSessionId) && row.id === currentSessionId,
    user: { id: row.user.id, email: row.user.email, name: row.user.name, disabled: Boolean(row.user.disabledAt), installationOwner: row.user.isInstanceOwner },
  }));
  return { items, truncated: rows.length > limit, limit, limits: { searchMaxCharacters: max } };
}

const signOutSchema = z.object({ confirmation: z.string() }).strict();

/** End one browser session. Atomic with its audit; the account itself is unchanged. */
export async function signOutRootSession(actorId: string, sessionId: string, input: unknown) {
  if (!sessionId || sessionId.length > 200) throw invalid('Choose a session.');
  const parsed = signOutSchema.safeParse(input);
  if (!parsed.success || parsed.data.confirmation !== sessionSignOutConfirmation(sessionId)) throw invalid('Enter the exact sign-out confirmation.');
  return rootTransaction(async tx => {
    const target = await tx.session.findUnique({ where: { id: sessionId }, select: { id: true, userId: true } });
    if (!target) throw new OperationError('not_found', 'Session not found. It may already have ended.');
    await lockRootActor(tx, actorId, [target.userId]);
    const removed = await tx.session.deleteMany({ where: { id: sessionId, userId: target.userId } });
    if (removed.count !== 1) throw new OperationError('conflict', 'The session changed. Reload and try again.');
    await writeRootAudit(tx, actorId, 'root.session_signed_out', { sessionId, userId: target.userId });
    return { signedOut: true, sessionId, userId: target.userId };
  });
}
