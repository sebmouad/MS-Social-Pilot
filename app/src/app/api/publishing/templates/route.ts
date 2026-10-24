import { requestOrigin } from '@/server/request-origin';
import { requireViewer } from '@/server/context';
import { readTemplatePage, createTemplate } from '@/modules/publishing/server/templates';
import { OperationError, operationFailure } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function GET(request: Request) {
  let viewer; try { viewer = await requireViewer({ feature: 'publishing/templates', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !['page', 'q'].includes(key) || params.getAll(key).length !== 1)) throw new OperationError('invalid_request', 'Choose valid template filters.');
    const page = params.get('page');
    if (page !== null && !/^[1-9]\d*$/.test(page)) throw new OperationError('invalid_request', 'Choose a valid result page.');
    return reply(await readTemplatePage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { ...(page ? { page: Number(page) } : {}), ...(params.has('q') ? { q: params.get('q') } : {}) }));
  } catch (error) { const failure = operationFailure(error, 'Templates could not be loaded.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let viewer; try { viewer = await requireViewer({ feature: 'publishing/templates', channelScoped: true, write: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try { return reply(await createTemplate({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, await request.json()), 201); }
  catch (error) { const typedError = error instanceof SyntaxError ? new OperationError('invalid_request', 'Enter valid template details.') : error; const failure = operationFailure(typedError, 'Template could not be saved.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}
