import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { readConnectionDirectory } from '@/modules/settings/server/connection-directory';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const viewer = await requireViewer({ feature: 'settings/connections' }).catch(() => { throw new OperationError('unauthorized', 'Sign in to an authorized workspace.'); });
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== 'offset') || params.getAll('offset').length > 1 || (params.has('offset') && !/^\d+$/.test(params.get('offset')!))) throw new OperationError('invalid_request', 'Choose a valid connection page.');
    return Response.json(await readConnectionDirectory({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, params.has('offset') ? { offset: Number(params.get('offset')) } : {}), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const safe = operationFailure(error, 'Connections could not be loaded.');
    return Response.json({ error: safe.error, code: safe.code }, { status: safe.status, headers: { 'cache-control': 'no-store' } });
  }
}
