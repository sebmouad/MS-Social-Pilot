import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hashSessionToken, isUsableSession, SESSION_COOKIE } from '@/server/auth';
import { prisma } from '@/server/data';

/** Root access is installation-wide and must not depend on workspace membership. */
export async function currentRootActor() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const tokenHash = token ? hashSessionToken(token) : null;
  if (!tokenHash) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, tokenHash: true, expiresAt: true, pending: true, user: { select: { id: true, disabledAt: true } } },
  });
  if (!isUsableSession(session, undefined)) return null;
  return prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, name: true, email: true, isInstanceOwner: true } });
}

export async function requireRootPage() {
  const actor = await currentRootActor();
  if (!actor) redirect('/sign-in');
  if (!actor.isInstanceOwner) redirect('/access-limited');
  return actor;
}
