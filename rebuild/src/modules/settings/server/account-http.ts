import { exportAccountData } from './account-export';
import { accountSessionActor } from './account-session';
import { requireViewer } from '@/server/context';
import { requestOrigin } from '@/server/request-origin';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { readAccount, updateAccountProfile, changeAccountPassword, listAccountSessions, revokeAccountSession } from './account';

import { readAccountSecurity, changeAccountSecurity } from './account-security';

const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
export async function accountHttp(request: Request, action: 'export' | 'read' | 'profile' | 'password' | 'sessions' | 'revoke' | 'security' | 'begin' | 'enable' | 'disable' | 'remove') {
  try {
    if (request.headers.has('authorization') || request.headers.has('x-api-key')) throw new OperationError('forbidden', 'Use a browser session.');
    if (['profile', 'password', 'revoke', 'begin', 'enable', 'disable', 'remove'].includes(action) && request.headers.get('origin') !== requestOrigin(request)) throw new OperationError('forbidden', 'Cross-origin request denied.');
    const viewer = await requireViewer({ feature: 'settings/account', channelScoped: true });
    const actor = await accountSessionActor(viewer.user.id, viewer.workspaceId);
    if (action === 'export') {
      if (request.method !== 'GET' || new URL(request.url).search) throw new OperationError('invalid_request', 'Account exports take no arguments.');
      const archive = await exportAccountData(actor);
      return new Response(archive.content, { headers: {
        'content-type': archive.mimeType, 'content-length': String(archive.bytes),
        'content-disposition': 'attachment', 'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      } });
    }
    if (action === 'security') return reply(await readAccountSecurity(actor));
    if (['begin', 'enable', 'disable', 'remove'].includes(action)) return reply(await changeAccountSecurity(actor, action as 'begin' | 'enable' | 'disable' | 'remove', await request.json()));
    if (action === 'read') return reply(await readAccount(actor));
    if (action === 'sessions') {
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some(key => key !== 'offset') || params.getAll('offset').length > 1 || (params.has('offset') && !/^\d+$/.test(params.get('offset')!))) throw new OperationError('invalid_request', 'Choose a valid session page.');
      return reply(await listAccountSessions(actor, params.has('offset') ? { offset: Number(params.get('offset')) } : {}));
    }
    const input = await request.json();
    return reply(action === 'profile' ? await updateAccountProfile(actor, input) : action === 'password' ? await changeAccountPassword(actor, input) : await revokeAccountSession(actor, input));
  } catch (error) {
    const digest = (error as { digest?: unknown } | null)?.digest;
    const safe = operationFailure(typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT') ? new OperationError('unauthorized', 'Sign in to continue.') : error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid JSON.') : error, 'Account settings could not be updated.');
    return reply({ error: safe.error, code: safe.code }, safe.status);
  }
}
