import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hashLegacySessionToken, isUsableLegacySession, LEGACY_SESSION_COOKIE } from './auth';
import { getSessionByTokenHash, listWorkspaces, prisma } from './data';
import { loadEntitlements, requireFeature, requireModule } from './entitlements';

/** Each request starts with a validated user and a current workspace membership. */
export async function requireViewer(access?: { module?: string; feature?: string }) {
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
  // Preserve the rebuild preview's existing role gate while applying the
  // product entitlement checks before the caller reads protected data.
  if (membership.role !== 'owner' && membership.role !== 'admin') redirect('/access-limited');
  const entitlements = await loadEntitlements(user.id, membership.workspace.id);
  if (!entitlements) redirect('/no-workspace');
  try {
    if (access?.module) requireModule(entitlements, access.module);
    if (access?.feature) requireFeature(entitlements, access.feature);
  } catch {
    redirect('/access-limited');
  }
  return { user, membership, workspaces, workspaceId: membership.workspace.id, entitlements };
}
