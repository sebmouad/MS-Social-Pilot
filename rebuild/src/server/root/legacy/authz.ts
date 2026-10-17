import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';

type Reader = { user: { findUnique(args: { where: { id: string }; select: { isInstanceOwner: true; disabledAt: true } }): Promise<{ isInstanceOwner: boolean; disabledAt: Date | null } | null> } };

/**
 * Root authority is read from the current account row, never from a workspace
 * role, membership or API key. Pass the transaction client when mutating so the
 * check shares the mutation's snapshot.
 */
export async function assertRootActor(db: Reader, actorId: string) {
  const actor = actorId ? await db.user.findUnique({ where: { id: actorId }, select: { isInstanceOwner: true, disabledAt: true } }) : null;
  if (!actor?.isInstanceOwner || actor.disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
}

export const invalid = (message = 'Check the request and try again.') => new OperationError('invalid_request', message);
export const conflict = (message: string) => new OperationError('conflict', message);

/** True when a legacy table is absent from this database (PostgreSQL 42P01). */
export function isMissingRelation(error: unknown) {
  const text = error instanceof Error ? `${error.message} ${JSON.stringify((error as { meta?: unknown }).meta ?? '')}` : '';
  return /42P01|does not exist/i.test(text);
}

const SECRET = /(bearer\s+[A-Za-z0-9._~+/=-]{8,}|(?:access_token|refresh_token|id_token|token|secret|client_secret|password|passwd|authorization|cookie|set-cookie|session|credential|code|api[_-]?key)["'\s:=]+[^\s"',;&]+|[A-Fa-f0-9]{32,}|eyJ[A-Za-z0-9._-]{20,}|[A-Za-z0-9+/_-]{40,})/gi;
/** Redact credential-shaped text and cap length before showing operator logs. */
export function redact(text: string | null | undefined, max: number): string | null {
  if (text == null) return null;
  const clean = text.replace(SECRET, '[redacted]').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** Lock current actor and affected accounts in the same order as account access controls. */
export async function lockRootActor(tx: Prisma.TransactionClient, actorId: string, accountIds: readonly string[] = []) {
  await assertRootActor(tx, actorId);
  const ids = [...new Set([actorId, ...accountIds])].sort();
  await tx.$queryRaw`SELECT id FROM users WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  await assertRootActor(tx, actorId);
}

/**
 * Lock the actor, the extra accounts and every current owner of a workspace.
 * Owners are re-read after the lock; unexpected growth aborts the transaction
 * rather than acquiring more row locks out of order. Callers own the workspace lock.
 */
export async function lockWorkspaceOwners(tx: Prisma.TransactionClient, actorId: string, workspaceId: string, extraIds: readonly string[] = []) {
  const before = await tx.membership.findMany({ where: { workspaceId, role: 'owner' }, select: { id: true, userId: true } });
  const ids = [actorId, ...extraIds, ...before.map(owner => owner.userId)];
  await lockRootActor(tx, actorId, ids);
  const after = await tx.membership.findMany({ where: { workspaceId, role: 'owner' }, select: { id: true, userId: true } });
  const locked = new Set(ids);
  if (!after.every(owner => locked.has(owner.userId))) throw conflict('Workspace owners are changing. Reload and try again.');
  return after;
}
