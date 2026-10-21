import { requestOrigin } from '@/server/request-origin';
import { operationFailure } from '@/lib/operation-error';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/context';
import { previewSocialAccountDeletion } from '@/server/connection-mutations';
import { changeConnectionSelections } from '@/modules/settings/server/connection-selection';
import { changeConnectionDisconnect } from '@/modules/settings/server/connection-disconnect';
import { withWorkspaceOperation } from '@/server/data-control/guard';

export const runtime = 'nodejs';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

const previewSchema = z.object({ socialAccountId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.' }, 403);
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/connections' }); }
  catch { return reply({ error: 'Not authorized.' }, 401); }
  try {
    const input = previewSchema.parse(await request.json());
    const counts = await previewSocialAccountDeletion({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input.socialAccountId);
    return reply({ counts });
  } catch (error) {
    return connectionError(error, 'Could not preview related data.');
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.' }, 403);
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/connections' }); }
  catch { return reply({ error: 'Not authorized.' }, 401); }
  try {
    const input: unknown = await request.json();
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    const result = await withWorkspaceOperation(viewer.workspaceId, () => changeConnectionSelections(actor, input));
    return reply(result);
  } catch (error) {
    return connectionError(error, 'The selection could not be saved.');
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.' }, 403);
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/connections' }); }
  catch { return reply({ error: 'Not authorized.' }, 401); }
  try {
    const input: unknown = await request.json();
    return reply(await changeConnectionDisconnect({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input));
  } catch (error) {
    return connectionError(error, 'The source could not be disconnected.');
  }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}

function connectionError(error: unknown, fallback: string) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return reply({ error: 'Invalid connection request.', code: 'invalid_request' }, 400);
  const failure = operationFailure(error, fallback);
  return reply({ error: failure.error, code: failure.code }, failure.status);
}
