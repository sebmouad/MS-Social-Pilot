import { requireViewer } from '@/server/context';
import { operationFailure, OperationError } from '@/lib/operation-error';
import { requestOrigin } from '@/server/request-origin';
import { ZodError } from 'zod';
import { postExportAction } from './entry-points';
import { postExportCopy } from './copy';
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
export async function postExportRoute(request: Request) {
 const locale = /^fr\b/i.test(request.headers.get('accept-language') ?? '') ? 'fr' : 'en';
 const copy = await postExportCopy(locale);
 try {
  if (request.method === 'POST' && request.headers.get('origin') !== requestOrigin(request)) throw new OperationError('forbidden', copy.failure);
  const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true });
  const scope = viewer.permissions.pageScope;
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId, ...(scope.all ? {} : { allowedTargetIds: scope.ids }) };
  const params = new URL(request.url).searchParams;
  if (request.method === 'GET' && [...params.keys()].some(key => !['action','id'].includes(key) || params.getAll(key).length !== 1)) throw new OperationError('invalid_request', copy.failure);
  const input = request.method === 'POST' ? await request.json() : { action: params.get('action'), id: params.get('id') };
  if (request.method === 'GET' && !['status','download'].includes(input.action)) throw new OperationError('invalid_request', copy.failure);
  const result = await postExportAction(actor, input);
  if ('csv' in result && typeof result.csv === 'string') return new Response(result.csv, { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="posts.csv"' } });
  return Response.json(result, { headers });
 } catch (error) {
  const failure = operationFailure(error instanceof ZodError || error instanceof SyntaxError ? new OperationError('invalid_request', copy.failure) : error, copy.failure);
  return Response.json({ error: copy.failure, code: failure.code }, { status: failure.status, headers });
 }
}
