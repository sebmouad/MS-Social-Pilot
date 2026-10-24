import { requestOrigin } from '@/server/request-origin';
import { labelInstants, workspaceInstantFormatter } from '@/server/instant-labels';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { performInboxModerationAction, readInboxModeration } from '@/modules/inbox/server/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
function sameOrigin(request: Request) { const origin = request.headers.get('origin'); if (!origin) return false; try { return new URL(origin).origin === requestOrigin(request); } catch { return false; } }
async function actor() { const viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true }); return { userId: viewer.user.id, workspaceId: viewer.workspaceId }; }

export async function GET(request: Request) {
  let current; try { current = await actor(); } catch (error) { const failure = operationFailure(error, 'Moderation rules could not be loaded. Please try again.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
  try {
    if ([...new URL(request.url).searchParams.keys()].length) throw new OperationError('invalid_request', 'Moderation rules do not accept URL parameters.');
    const moderation = await readInboxModeration(current);
    const instants = await workspaceInstantFormatter(current.workspaceId, /^\s*fr\b/i.test(request.headers.get('accept-language') ?? '') ? 'fr' : 'en');
    return reply({ ...moderation, log: moderation.log.map(row => labelInstants(row, { createdAt: 'dateTime' }, instants)) });
  } catch (error) { const failure = operationFailure(error, 'Moderation rules could not be loaded. Please try again.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let current; try { current = await actor(); } catch (error) { const failure = operationFailure(error, 'The moderation outcome is unconfirmed. Check the log before trying again.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
  try {
    if ([...new URL(request.url).searchParams.keys()].length) throw new OperationError('invalid_request', 'Moderation actions do not accept URL parameters.');
    // The service owns its workspace lock; do not wrap it in another one here.
    const result = await performInboxModerationAction(current, await request.json());
    if (result?.ok !== true) throw new OperationError('upstream_failure', 'The moderation outcome is unconfirmed. Check the log before trying again.');
    return reply(result);
  } catch (error) {
    const typed = error instanceof z.ZodError || error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid moderation action.') : error;
    const failure = operationFailure(typed, 'The moderation outcome is unconfirmed. Check the log before trying again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
