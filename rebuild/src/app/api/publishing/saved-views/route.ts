import { requireViewer } from '@/server/context';
import { createSavedView, listSavedViews } from '@/modules/publishing/server/saved-views';
import { OperationError, operationFailure } from '@/lib/operation-error';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const feature = (screen: unknown) => screen === 'calendar' ? 'publishing/calendar' as const : 'publishing/posts' as const;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const screen = params.get('screen');
  let viewer; try { viewer = await requireViewer({ feature: feature(screen), channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    if ([...params.keys()].some(key => key !== 'screen') || params.getAll('screen').length !== 1) throw new OperationError('invalid_request', 'Choose a valid screen.');
    return reply(await listSavedViews({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { screen }));
  } catch (error) { const failure = operationFailure(error, 'Saved views could not be loaded.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let body: unknown;
  try { body = await request.json(); } catch { return reply({ error: 'Enter valid saved view details.', code: 'invalid_request' }, 400); }
  let viewer; try { viewer = await requireViewer({ feature: feature((body as { screen?: unknown } | null)?.screen), channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try { return reply(await createSavedView({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, body), 201); }
  catch (error) { const failure = operationFailure(error, 'The view could not be saved.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
