import { operationFailure } from '@/lib/operation-error';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/context';
import { disconnectSocialAccount, previewSocialAccountDeletion, setConnectionSelections } from '@/server/connection-mutations';
import { withWorkspaceOperation } from '@/server/data-control/guard';

export const runtime = 'nodejs';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
const selectionSchema = z.object({ items: z.array(z.object({ kind: z.enum(['target', 'adAccount']), id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), enabled: z.boolean() })).max(250) });
const disconnectSchema = z.object({ socialAccountId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), mode: z.enum(['retain', 'delete']).default('retain'), confirmation: z.string().max(20).optional() });
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
    const input = selectionSchema.parse(await request.json());
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    await withWorkspaceOperation(viewer.workspaceId, () => setConnectionSelections(actor, input.items));
    return reply({ ok: true });
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
    const input = disconnectSchema.parse(await request.json());
    const result = await withWorkspaceOperation(viewer.workspaceId, () => disconnectSocialAccount({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input.socialAccountId, input.mode, input.confirmation));
    return reply({ ok: true, ...result });
  } catch (error) {
    return connectionError(error, 'The source could not be disconnected.');
  }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function connectionError(error: unknown, fallback: string) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return reply({ error: 'Invalid connection request.', code: 'invalid_request' }, 400);
  const failure = operationFailure(error, fallback);
  return reply({ error: failure.error, code: failure.code }, failure.status);
}
