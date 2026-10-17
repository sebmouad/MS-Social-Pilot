import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { addTeamMember, getTeamDirectory, removeTeamMember, updateTeamMember } from '@/modules/settings/server/team';

export const runtime = 'nodejs';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function GET() {
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/team' }); }
  catch { return reply({ error: 'Sign in with workspace team access.', code: 'unauthorized' }, 401); }
  try {
    return reply(await getTeamDirectory({ userId: viewer.user.id, workspaceId: viewer.workspaceId }));
  } catch (error) { return failure(error); }
}

async function mutate(request: Request, action: 'add' | 'update' | 'remove') {
  const origin = request.headers.get('origin');
  try {
    if (!origin || new URL(origin).origin !== new URL(request.url).origin) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  } catch { return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403); }
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/team', write: true }); }
  catch { return reply({ error: 'Sign in with workspace team access.', code: 'unauthorized' }, 401); }
  let input: unknown;
  try { input = await request.json(); }
  catch { return reply({ error: 'Invalid team change.', code: 'invalid_request' }, 400); }
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  try {
    const result = action === 'add' ? await addTeamMember(actor, input)
      : action === 'update' ? await updateTeamMember(actor, input)
        : await removeTeamMember(actor, input);
    return reply({ ok: true, ...result });
  } catch (error) { return failure(error); }
}

function failure(error: unknown) {
  const safe = operationFailure(error, 'The team change could not be confirmed. Check current access before trying again.');
  return reply({ error: safe.error, code: safe.code }, safe.status);
}

export const POST = (request: Request) => mutate(request, 'add');
export const PATCH = (request: Request) => mutate(request, 'update');
export const DELETE = (request: Request) => mutate(request, 'remove');
