import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/context';
import { disconnectSocialAccount, previewSocialAccountDeletion, setConnectionSelections } from '@/server/connection-mutations';

export const runtime = 'nodejs';
const selectionSchema = z.object({ items: z.array(z.object({ kind: z.enum(['target', 'adAccount']), id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), enabled: z.boolean() })).max(250) });
const disconnectSchema = z.object({ socialAccountId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), mode: z.enum(['retain', 'delete']).default('retain'), confirmation: z.string().max(20).optional() });
const previewSchema = z.object({ socialAccountId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/connections' }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  try {
    const input = previewSchema.parse(await request.json());
    const counts = await previewSocialAccountDeletion({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input.socialAccountId);
    return NextResponse.json({ counts }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return connectionError(error, 'Could not preview related data.');
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/connections' }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  try {
    const input = selectionSchema.parse(await request.json());
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    await setConnectionSelections(actor, input.items);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return connectionError(error, 'The selection could not be saved.');
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/connections' }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  try {
    const input = disconnectSchema.parse(await request.json());
    const result = await disconnectSocialAccount({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input.socialAccountId, input.mode, input.confirmation);
    return NextResponse.json({ ok: true, ...result });
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
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid connection request.' }, { status: 400 });
  if (!(error instanceof Error)) return NextResponse.json({ error: fallback }, { status: 500 });
  const known: Array<[string, number]> = [
    ['unavailable in the current workspace', 404],
    ['Only workspace owners and admins', 403],
    ['Reconnect this source', 409],
    ['You are no longer a member', 401],
    ['Invalid selection list', 400],
    ['Type DELETE', 400],
    ['still scheduled at the provider', 409],
  ];
  const match = known.find(([phrase]) => error.message.includes(phrase));
  return match
    ? NextResponse.json({ error: error.message }, { status: match[1] })
    : NextResponse.json({ error: fallback }, { status: 500 });
}
