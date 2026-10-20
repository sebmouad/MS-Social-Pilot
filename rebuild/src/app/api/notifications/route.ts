import { requestOrigin } from '@/server/request-origin';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { listNotifications, markNotificationRead, deleteNotification, readNotificationPreferences, updateNotificationPreferences } from '@/modules/settings/notifications/server';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const invalidQuery = () => new OperationError('invalid_request', 'Choose valid notification filters.');

export async function GET(request: Request) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/notifications', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !['page', 'unreadOnly'].includes(key) || params.getAll(key).length !== 1)) throw invalidQuery();
    const pageText = params.get('page');
    if (pageText !== null && !/^[1-9]\d{0,5}$/.test(pageText)) throw invalidQuery();
    const unreadText = params.get('unreadOnly');
    if (unreadText !== null && unreadText !== 'true' && unreadText !== 'false') throw invalidQuery();
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    const [preferences, notifications] = await Promise.all([
      readNotificationPreferences(actor),
      listNotifications(actor, { ...(pageText ? { page: Number(pageText) } : {}), ...(unreadText === 'true' ? { unreadOnly: true } : {}) }),
    ]);
    return reply({ preferences, notifications });
  } catch (error) {
    const failure = operationFailure(error, 'Notifications could not be loaded. Please try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/notifications', channelScoped: true, write: true }); }
  catch { return reply({ error: 'Notification preferences are unavailable for this account.', code: 'forbidden' }, 403); }
  try {
    if (new URL(request.url).search) throw invalidQuery();
    const input = await request.json();
    return reply({ preferences: await updateNotificationPreferences({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input) });
  } catch (error) {
    const typed = error instanceof SyntaxError ? new OperationError('invalid_request', 'Enter valid notification preferences.') : error;
    const failure = operationFailure(typed, 'Notification preferences could not be saved. Please try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}

async function resourceAction(request: Request, method: 'PATCH' | 'DELETE') {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/notifications', channelScoped: true, write: true }); }
  catch { return reply({ error: 'Notification access is unavailable for this account.', code: 'forbidden' }, 403); }
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== 'id' || params.getAll(key).length !== 1)) throw invalidQuery();
    const id = params.get('id');
    if (!id || id.length > 200) throw invalidQuery();
    const input = await request.json();
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'confirmation') || typeof input.confirmation !== 'string') throw invalidQuery();
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    if (method === 'PATCH') return reply(await markNotificationRead(actor, { id, confirmation: input.confirmation }));
    return reply(await deleteNotification(actor, { id, confirmation: input.confirmation }));
  } catch (error) {
    const typed = error instanceof SyntaxError ? new OperationError('invalid_request', 'Review the alert action and try again.') : error;
    const failure = operationFailure(typed, 'The alert could not be updated. Please try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}

export const PATCH = (request: Request) => resourceAction(request, 'PATCH');
export const DELETE = (request: Request) => resourceAction(request, 'DELETE');

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}
