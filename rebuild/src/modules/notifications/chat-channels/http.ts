import { requireViewer } from '@/server/context';
import { requestOrigin } from '@/server/request-origin';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { createChatChannel, deleteChatChannel, listChatChannels, testChatChannel, updateChatChannel } from './server/service';
import { CHAT_CHANNELS_FEATURE } from './manifest';

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
type Context = { params: Promise<{ id: string }> };
async function handle(request: Request, action: 'list' | 'create' | 'update' | 'delete' | 'test', context?: Context) {
  try {
    if (new URL(request.url).search) throw new OperationError('invalid_request', 'URL parameters are not accepted.');
    const write = action !== 'list';
    if (write) {
      let same = false; try { same = new URL(request.headers.get('origin') ?? '').origin === requestOrigin(request); } catch { /* fail closed */ }
      if (!same) throw new OperationError('forbidden', 'Cross-origin request denied.');
    }
    const viewer = await requireViewer({ feature: CHAT_CHANNELS_FEATURE, write });
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    if (!write) return reply(await listChatChannels(actor));
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OperationError('invalid_request', 'Expected a JSON object.');
    const id = context ? (await context.params).id : undefined;
    if (Object.hasOwn(body, 'id')) throw new OperationError('invalid_request', 'The destination is selected by the route.');
    const input = { ...body, ...(id ? { id } : {}) };
    switch (action) {
      case 'create': return reply(await createChatChannel(actor, input), 201);
      case 'update': return reply(await updateChatChannel(actor, input));
      case 'delete': return reply(await deleteChatChannel(actor, input));
      case 'test': return reply(await testChatChannel(actor, input));
    }
  } catch (error) {
    const safe = operationFailure(error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid JSON.') : error, 'The chat request could not be confirmed.');
    return reply({ error: safe.error, code: safe.code }, safe.status);
  }
}
/** Thin route exports for the integrator; no domain policy in the REST adapters. */
export const GET = (request: Request) => handle(request, 'list');
export const POST = (request: Request) => handle(request, 'create');
export const PATCH = (request: Request, context: Context) => handle(request, 'update', context);
export const DELETE = (request: Request, context: Context) => handle(request, 'delete', context);
export const TEST = (request: Request, context: Context) => handle(request, 'test', context);
