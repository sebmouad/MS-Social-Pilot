import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { changeChannelProfiles, readChannelProfiles } from './service';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
async function handle(request: Request, write: boolean) {
  try {
    if (new URL(request.url).search) throw new OperationError('invalid_request', 'URL parameters are not accepted.');
    if (write) { let same = false; try { same = new URL(request.headers.get('origin') ?? '').origin === new URL(request.url).origin; } catch {} if (!same) throw new OperationError('forbidden', 'Cross-origin request denied.'); }
    let viewer; try { viewer = await requireViewer({ feature: 'settings/connections', write }); } catch { throw new OperationError('unauthorized', 'Sign in to continue.'); }
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    return reply(write ? await changeChannelProfiles(actor, await request.json()) : await readChannelProfiles(actor));
  } catch (error) { const result = operationFailure(error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid JSON.') : error, 'Channel profiles are unavailable.'); return reply({ error: result.error, code: result.code }, result.status); }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
