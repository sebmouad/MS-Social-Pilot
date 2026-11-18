import { NextResponse } from 'next/server';
import { requestOrigin } from '@/server/request-origin';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { previewAiReplies } from '@/modules/inbox/server/ai-replies';

/** What the AI would answer to recent comments and messages (2026-11-17); nothing is sent. Owners and admins. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
function sameOrigin(request: Request) { const origin = request.headers.get('origin'); if (!origin) return false; try { return new URL(origin).origin === requestOrigin(request); } catch { return false; } }

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  try {
    const viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true });
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId, ...(viewer.permissions.pageScope.all ? {} : { allowedChannelIds: [...viewer.permissions.pageScope.ids] }) };
    const body = await request.json().catch(() => { throw new OperationError('invalid_request', 'Invalid AI auto-reply settings.'); });
    return reply(await previewAiReplies(actor, body));
  } catch (error) { const failure = operationFailure(error, 'The preview could not be made. Please try again.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}
