import { requestOrigin } from '@/server/request-origin';
import { requireViewer } from '@/server/context';
import { createInboxSavedView, listInboxSavedViews } from '@/modules/inbox/server/saved-views';
import { operationFailure } from '@/lib/operation-error';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function GET() {
  let viewer; try { viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    return reply(await listInboxSavedViews({ userId: viewer.user.id, workspaceId: viewer.workspaceId }));
  } catch (error) {
    const failure = operationFailure(error, 'Saved views could not be loaded.');
    if (failure.code === 'unavailable') return reply({ views: [], unavailable: true, error: failure.error, code: failure.code });
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try { if (!origin || new URL(origin).origin !== requestOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403); }
  catch { return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403); }
  let body: unknown;
  try { body = await request.json(); } catch { return reply({ error: 'Enter valid saved view details.', code: 'invalid_request' }, 400); }
  let viewer; try { viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try { return reply(await createInboxSavedView({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, body), 201); }
  catch (error) { const failure = operationFailure(error, 'The view could not be saved.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}
