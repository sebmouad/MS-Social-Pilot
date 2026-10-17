import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { listSavedReplies, performInboxProductivityAction, readInboxProductivity } from '@/modules/inbox/server/productivity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
function sameOrigin(request: Request) { const origin = request.headers.get('origin'); if (!origin) return false; try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; } }
async function actor() { const viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true }); return { userId: viewer.user.id, workspaceId: viewer.workspaceId }; }
export async function GET(request: Request) {
  let current; try { current = await actor(); } catch (error) { const failure = operationFailure(error, 'Inbox productivity could not be loaded. Please try again.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => query.getAll(key).length > 1)) throw new OperationError('invalid_request', 'Choose a valid Inbox productivity view.');
    if (query.get('view') === 'saved-replies') {
      if ([...query.keys()].some(key => !['view','offset','limit','q'].includes(key))) throw new OperationError('invalid_request', 'Choose a valid Inbox productivity view.');
      const offset = query.get('offset'), limit = query.get('limit');
      return reply(await listSavedReplies(current, { ...(offset !== null ? { offset: /^\d+$/.test(offset) ? Number(offset) : offset } : {}), ...(limit !== null ? { limit: /^\d+$/.test(limit) ? Number(limit) : limit } : {}), q: query.get('q') ?? '' }));
    }
    if (query.has('view') || [...query.keys()].length !== 2 || !query.has('kind') || !query.has('id')) throw new OperationError('invalid_request', 'Choose a valid Inbox productivity view.');
    return reply(await readInboxProductivity(current, { kind: query.get('kind'), id: query.get('id') }));
  } catch (error) { const failure = operationFailure(error, 'Inbox productivity could not be loaded. Please try again.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let current; try { current = await actor(); } catch (error) { const failure = operationFailure(error, 'The Inbox action outcome is unconfirmed. Inspect the item before repeating the action.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
  try {
    if ([...new URL(request.url).searchParams.keys()].length) throw new OperationError('invalid_request', 'Inbox actions do not accept URL parameters.');
    const result = await performInboxProductivityAction(current, await request.json());
    if (result?.ok !== true) throw new OperationError('upstream_failure', 'The Inbox action outcome is unconfirmed. Inspect the item before repeating the action.');
    return reply(result);
  } catch (error) {
    const typed = error instanceof z.ZodError || error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid Inbox productivity action.') : error;
    const failure = operationFailure(typed, 'The Inbox action outcome is unconfirmed. Inspect the item before repeating the action.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
