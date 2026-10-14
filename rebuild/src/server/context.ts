import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hashLegacySessionToken, isUsableLegacySession, LEGACY_SESSION_COOKIE } from './auth';
import { getSessionByTokenHash, listWorkspaces, prisma } from './data';

/** Each request starts with a validated user and a current workspace membership. */
export async function requireViewer() {
  const token = (await cookies()).get(LEGACY_SESSION_COOKIE)?.value;
  const hash = token ? hashLegacySessionToken(token) : null;
  if (!hash) redirect('/sign-in');
  const session = await getSessionByTokenHash(hash);
  if (!isUsableLegacySession(session, undefined)) redirect('/sign-in');
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, name: true, email: true } });
  if (!user) redirect('/sign-in');
  const workspaces = await listWorkspaces(user.id);
  if (!workspaces.length) redirect('/no-workspace');
  const selected = (await cookies()).get('sp_workspace')?.value;
  const membership = workspaces.find((item) => item.workspace.id === selected) ?? workspaces.find(item => item.role === 'owner' || item.role === 'admin') ?? workspaces[0]!;
  // Page-level and client screen scopes are not mapped by the rebuild yet.
  // Keep those accounts on the existing app until the new authorization layer exists.
  if (membership.role !== 'owner' && membership.role !== 'admin') redirect('/access-limited');
  return { user, membership, workspaces, workspaceId: membership.workspace.id };
}
