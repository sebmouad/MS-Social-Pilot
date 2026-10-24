import { NextResponse } from 'next/server';
import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { prisma, getSessionByTokenHash } from '@/server/data';
import { isUsableSession } from '@/server/auth';
import { auditAccountMutation } from '@/server/account-settings';
import { runtimeConfig } from '@/server/config/store';
import { loadEntitlements, canUseFeature, hasPlatformCapability } from '@/server/entitlements';
import { loadPermissions } from '@/server/permissions/loader';
import { canAccessFeature } from '@/server/permissions';
import { connectionFlow } from '@/server/platforms/registry';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { requestOrigin } from '@/server/request-origin';
import type { AccountActor } from './account';

export const connectionStartConfirmation = (platform: string) => `START CONNECTION ${platform}`;

/** Session authority, confirmation and audit apply to every connection entry point.
 * The response contains only the public authorization URL. Private provider state
 * stays in Set-Cookie and must be forwarded by the transport, never tool data.
 */
export async function startConnection(actor: AccountActor, input: unknown, request: Request): Promise<NextResponse> {
  if (actor.apiKeyId || !actor.sessionTokenHash) throw new OperationError('forbidden', 'Use a signed-in browser session to connect an account.');
  if (!isUsableSession(await getSessionByTokenHash(actor.sessionTokenHash), actor.userId)) throw new OperationError('unauthorized', 'Sign in to continue.');
  const parsed = z.object({ platform: z.string().min(1), confirmation: z.string() }).strict().safeParse(input);
  if (!parsed.success || parsed.data.confirmation !== connectionStartConfirmation(parsed.data.platform)) throw new OperationError('invalid_request', 'Confirm the account connection before continuing.');
  // A configured public origin wins over proxy/Host input. The HTTP adapter also
  // validates Origin; MCP constructs this request exclusively from Root config.
  const configured = await runtimeConfig('app.publicOrigin');
  const origin = configured || requestOrigin(request);
  let base: URL;
  try {
    base = new URL(origin);
    if (base.origin !== origin || base.username || base.password || !['https:', 'http:'].includes(base.protocol)) throw new Error('origin');
    if (request.headers.get('origin') !== requestOrigin(request)) throw new Error('origin');
  } catch { throw new OperationError('forbidden', 'Cross-origin request denied.'); }
  const canonicalRequest = new Request(new URL(new URL(request.url).pathname, base), { method: 'POST' });
  return withWorkspaceOperation(actor.workspaceId, async () => {
    const [membership, permissions, entitlements] = await Promise.all([
      prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } }),
      loadPermissions(actor.userId, actor.workspaceId),
      loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    ]);
    if (!membership || !['owner', 'admin'].includes(membership.role) || !permissions || !canAccessFeature(permissions, 'settings/connections', 'write') || !entitlements || entitlements.workspaceId !== actor.workspaceId || !canUseFeature(entitlements, 'settings/connections')) throw new OperationError('forbidden', 'Only workspace owners and admins can connect accounts.');
    const platform = parsed.data.platform;
    const flow = hasPlatformCapability(entitlements, platform) ? await connectionFlow(platform) : null;
    if (!flow || !await flow.isReady()) throw new OperationError('unavailable', 'This connection is unavailable.');
    const providerResponse = await flow.start(canonicalRequest, { user: { id: actor.userId }, workspaceId: actor.workspaceId });
    const payload = await providerResponse.json().catch(() => null);
    if (!providerResponse.ok || typeof payload?.authorizationUrl !== 'string') throw new OperationError('upstream_failure', 'Connection unavailable. Try again or contact support.');
    let url: URL;
    try {
      url = new URL(payload.authorizationUrl);
      if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost'))) throw new Error('url');
    } catch { throw new OperationError('upstream_failure', 'Connection unavailable. Try again or contact support.'); }
    await prisma.$transaction(tx => auditAccountMutation(tx, actor.userId, 'connection.authorization_started', { workspaceId: actor.workspaceId, platform }));
    const response = NextResponse.json({ authorizationUrl: url.toString() }, { headers: { 'cache-control': 'no-store' } });
    for (const cookie of providerResponse.cookies.getAll()) response.cookies.set(cookie);
    return response;
  });
}
