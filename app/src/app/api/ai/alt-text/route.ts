import { NextResponse } from 'next/server';
import { operationFailure } from '@/lib/operation-error';
import { requireViewer } from '@/server/context';
import { requestOrigin } from '@/server/request-origin';
import { suggestAltText } from '@/modules/studio/server/alt-text';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2_000;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
function sameOrigin(request: Request) { const origin = request.headers.get('origin'); if (!origin) return false; try { return new URL(origin).origin === requestOrigin(request); } catch { return false; } }

/** Suggest a description for one stored workspace image. Review only: nothing is saved or published. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let current;
  try {
    const viewer = await requireViewer({ module: 'publishing', feature: 'publishing/posts', channelScoped: true, write: true });
    current = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  } catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return reply({ error: 'Choose one stored image of this workspace.', code: 'invalid_request' }, 400);
    let body: unknown; try { body = JSON.parse(text); } catch { return reply({ error: 'Choose one stored image of this workspace.', code: 'invalid_request' }, 400); }
    return reply(await suggestAltText(current, body));
  } catch (error) { const f = operationFailure(error, 'AI assist could not complete this request.'); return reply({ error: f.error, code: f.code }, f.status); }
}
