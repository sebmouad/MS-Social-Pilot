import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { readWorkspacePolicy, updateWorkspacePolicy } from '@/modules/settings/server/workspace-policy';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
function sameOrigin(request: Request) { const origin = request.headers.get('origin'); if (!origin) return false; try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; } }
export async function GET(request: Request) {
  if ([...new URL(request.url).searchParams.keys()].length) return reply({ error: 'Workspace policy reads do not accept URL parameters.', code: 'invalid_request' }, 400);
  let viewer; try { viewer = await requireViewer({ feature: 'settings/workspace' }); } catch { return reply({ error: 'Not authorized.', code: 'unauthorized' }, 401); }
  try { return reply(await readWorkspacePolicy({ userId: viewer.user.id, workspaceId: viewer.workspaceId })); }
  catch (error) { const result = operationFailure(error, 'Workspace policies could not be loaded.'); return reply({ error: result.error, code: result.code }, result.status); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let viewer; try { viewer = await requireViewer({ feature: 'settings/workspace', write: true }); } catch { return reply({ error: 'Not authorized.', code: 'unauthorized' }, 401); }
  try {
    if ([...new URL(request.url).searchParams.keys()].length) throw new OperationError('invalid_request', 'Workspace policy actions do not accept URL parameters.');
    return reply(await updateWorkspacePolicy({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, await request.json()));
  } catch (error) { const typed = error instanceof z.ZodError || error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid workspace policy action.') : error; const result = operationFailure(typed, 'Workspace policy changes could not be confirmed. Refresh before trying again.'); return reply({ error: result.error, code: result.code }, result.status); }
}
