import { requireViewer } from '@/server/context';
import { deleteTemplate, updateTemplate } from '@/modules/publishing/server/templates';
import { OperationError, operationFailure } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
type Context = { params: Promise<{ id: string }> };
async function actor() { const viewer = await requireViewer({ feature: 'publishing/templates', channelScoped: true, write: true }); return { userId: viewer.user.id, workspaceId: viewer.workspaceId }; }
async function fail(error: unknown) { const failure = operationFailure(error, 'Template operation could not be completed.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
export async function PUT(request: Request, context: Context) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let current; try { current = await actor(); } catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try { const { id } = await context.params; return reply(await updateTemplate(current, { ...(await request.json()), id })); } catch (error) { return fail(error instanceof SyntaxError ? new OperationError('invalid_request', 'Enter valid template details.') : error); }
}
export async function DELETE(request: Request, context: Context) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let current; try { current = await actor(); } catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    const { id } = await context.params;
    let body: unknown = {}; try { body = await request.json(); } catch { throw new OperationError('invalid_request', 'Confirm the exact template deletion.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.hasOwn(body, 'id')) throw new OperationError('invalid_request', 'Choose a valid template deletion.');
    return reply(await deleteTemplate(current, { ...body, id }));
  } catch (error) { return fail(error); }
}
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
