import { NextResponse } from 'next/server';
import { requestOrigin } from '@/server/request-origin';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { readAiReplies, saveAiReplies } from '@/modules/inbox/server/ai-replies';

/** AI auto-replies settings (2026-11-17): read by Inbox members, changed by owners and admins. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
function sameOrigin(request: Request) { const origin = request.headers.get('origin'); if (!origin) return false; try { return new URL(origin).origin === requestOrigin(request); } catch { return false; } }
async function actor() {
  const viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true });
  return { userId: viewer.user.id, workspaceId: viewer.workspaceId, ...(viewer.permissions.pageScope.all ? {} : { allowedChannelIds: [...viewer.permissions.pageScope.ids] }) };
}

export async function GET(request: Request) {
  try {
    if ([...new URL(request.url).searchParams.keys()].length) throw new OperationError('invalid_request', 'AI auto-replies do not accept URL parameters.');
    return reply(await readAiReplies(await actor()));
  } catch (error) { const failure = operationFailure(error, 'AI auto-replies could not be loaded. Please try again.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  try {
    const body = await request.json().catch(() => { throw new OperationError('invalid_request', 'Invalid AI auto-reply settings.'); });
    return reply(await saveAiReplies(await actor(), body));
  } catch (error) { const failure = operationFailure(error, 'AI auto-replies could not be saved. Please try again.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}
