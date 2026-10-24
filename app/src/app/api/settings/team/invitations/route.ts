import { requestOrigin } from '@/server/request-origin';
import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { inviteTeamMember, listTeamInvitations, revokeTeamInvitation } from '@/modules/settings/server/invitations';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function GET() {
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/team' }); }
  catch { return reply({ error: 'Sign in with team access.', code: 'unauthorized' }, 401); }
  try { return reply(await listTeamInvitations({ userId: viewer.user.id, workspaceId: viewer.workspaceId })); }
  catch (error) { return failure(error); }
}
async function write(request: Request, revoke: boolean) {
  if (request.headers.get('origin') !== requestOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/team', write: true }); }
  catch { return reply({ error: 'Sign in with team access.', code: 'unauthorized' }, 401); }
  let body: unknown;
  try { body = await request.json(); } catch { return reply({ error: 'Invalid invitation details.', code: 'invalid_request' }, 400); }
  try {
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    return reply({ ok: true, ...(revoke ? await revokeTeamInvitation(actor, body) : await inviteTeamMember(actor, body)) });
  } catch (error) { return failure(error); }
}
function failure(error: unknown) {
  const safe = operationFailure(error, 'The invitation change could not be confirmed. Check the invitation list before trying again.');
  return reply({ error: safe.error, code: safe.code }, safe.status);
}
export const POST = (request: Request) => write(request, false);
export const DELETE = (request: Request) => write(request, true);
