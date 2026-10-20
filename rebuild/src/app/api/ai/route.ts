import { requestOrigin } from '@/server/request-origin';
import { NextResponse } from 'next/server';
import { operationFailure } from '@/lib/operation-error';
import { requireViewer } from '@/server/context';
import { aiStatus, runAssist } from '@/modules/ai/server/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 100_000;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
function sameOrigin(request: Request) { const origin = request.headers.get('origin'); if (!origin) return false; try { return new URL(origin).origin === requestOrigin(request); } catch { return false; } }
/** Entry-point gate (module + feature); the service repeats the full check, this only refuses early. */
async function actor(write: boolean) {
  const viewer = await requireViewer({ module: 'publishing', feature: 'publishing/posts', channelScoped: true, ...(write ? { write: true } : {}) });
  return { userId: viewer.user.id, workspaceId: viewer.workspaceId };
}
const UNSIGNED = () => reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401);

export async function GET() {
  let current; try { current = await actor(false); } catch { return UNSIGNED(); }
  try { return reply(await aiStatus(current)); }
  catch (error) { const f = operationFailure(error, 'AI assist status could not be loaded.'); return reply({ error: f.error, code: f.code }, f.status); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let current; try { current = await actor(true); } catch { return UNSIGNED(); }
  try {
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return reply({ error: 'Shorten the text for AI assist.', code: 'invalid_request' }, 400);
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return reply({ error: 'Shorten the text for AI assist.', code: 'invalid_request' }, 400);
    let body: unknown; try { body = JSON.parse(text); } catch { return reply({ error: 'Enter the text and options for AI assist.', code: 'invalid_request' }, 400); }
    return reply(await runAssist(current, body));
  } catch (error) { const f = operationFailure(error, 'AI assist could not complete this request.'); return reply({ error: f.error, code: f.code }, f.status); }
}
