import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hashSessionToken, isUsableSession, SESSION_COOKIE } from './auth';
import { getSessionByTokenHash, listWorkspaces, prisma } from './data';
import { loadEntitlements, requireFeature, requireModule } from './entitlements';
import { PERMISSION_MODULES, canAccessFeature, canAccessModule } from './permissions';
import { loadPermissions } from './permissions/loader';
import { assertWorkspaceNotPurging } from './data-control/guard';
import { parseChannelScope, type ChannelScope } from '@/lib/channel-scope';

/** Each request starts with a validated user and a current workspace membership. */
export async function requireViewer(access?: { module?: string; feature?: string; channelScoped?: boolean; write?: boolean }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const hash = token ? hashSessionToken(token) : null;
  if (!hash) redirect('/sign-in');
  const session = await getSessionByTokenHash(hash);
  if (!isUsableSession(session, undefined)) redirect('/sign-in');
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, name: true, email: true, isInstanceOwner: true } });
  if (!user) redirect('/sign-in');
  const workspaces = await listWorkspaces(user.id);
  if (!workspaces.length) redirect('/no-workspace');
  const selected = (await cookies()).get('sp_workspace')?.value;
  const membership = workspaces.find((item) => item.workspace.id === selected) ?? workspaces.find(item => item.role === 'owner' || item.role === 'admin') ?? workspaces[0]!;
  if (access?.write) await assertWorkspaceNotPurging(membership.workspace.id);
  // The preview remains owner/admin-only except for routes whose data layer
  // enforces workspace and assigned-channel scope on every operation.
  if (!access?.channelScoped && membership.role !== 'owner' && membership.role !== 'admin') redirect('/access-limited');
  const entitlements = await loadEntitlements(user.id, membership.workspace.id, { allowInstallationInspection: false });
  if (!entitlements) redirect('/no-workspace');
  const permissions = await loadPermissions(user.id, membership.workspace.id);
  if (!permissions) redirect('/access-limited');
  try {
    if (access?.module) requireModule(entitlements, access.module);
    if (access?.feature) requireFeature(entitlements, access.feature);
    if (access?.module && (PERMISSION_MODULES as readonly string[]).includes(access.module) && !canAccessModule(permissions, access.module)) redirect('/access-limited');
    if (access?.feature && !canAccessFeature(permissions, access.feature)) redirect('/access-limited');
  } catch {
    redirect('/access-limited');
  }
  return { user, membership, workspaces, workspaceId: membership.workspace.id, entitlements, permissions };
}

export { parseChannelScope, type ChannelScope };

/**
 * The channel scope of a request for channel-aware pages: the `channel` URL parameter (older names mapped), else the
 * remembered cookie, reduced to channels in `allowedIds`. Display filter only; the page's service still authorizes every read.
 */
export async function requestChannelScope(viewer: { workspaceId: string }, searchParams: Record<string, string | string[] | undefined>, allowedIds: readonly string[], cookiePrefix: string) {
  const remembered = (await cookies()).get(`${cookiePrefix}${viewer.workspaceId}`)?.value;
  return parseChannelScope({ search: searchParams, cookie: remembered, allowed: allowedIds });
}
