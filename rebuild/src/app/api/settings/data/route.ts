import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/context';
import { deleteWorkspaceData, exportWorkspaceData, previewWorkspaceDataDeletion } from '@/server/data-control';

export const runtime = 'nodejs';
const deleteSchema = z.object({ confirmation: z.string().max(20) });

export async function POST() {
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/data' }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  try {
    const counts = await previewWorkspaceDataDeletion({ userId: viewer.user.id, workspaceId: viewer.workspaceId });
    return NextResponse.json({ counts }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return dataError(error, 'Could not preview workspace data deletion.'); }
}

export async function GET() {
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/data' }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  try {
    const payload = await exportWorkspaceData({ userId: viewer.user.id, workspaceId: viewer.workspaceId });
    const safeSlug = viewer.membership.workspace.slug.replace(/[^A-Za-z0-9_-]/g, '-');
    const filename = `workspace-${safeSlug}-export-${new Date().toISOString().slice(0, 10)}.json`;
    return new Response(JSON.stringify(payload, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store' } });
  } catch (error) { return dataError(error, 'Could not export workspace data.'); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/data' }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  try {
    const input = deleteSchema.parse(await request.json());
    const counts = await deleteWorkspaceData({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input.confirmation);
    return NextResponse.json({ ok: true, counts });
  } catch (error) { return dataError(error, 'Could not delete workspace data.'); }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function dataError(error: unknown, fallback: string) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid data request.' }, { status: 400 });
  if (!(error instanceof Error)) return NextResponse.json({ error: fallback }, { status: 500 });
  const known: Array<[string, number]> = [['no longer a member', 401], ['owners and admins', 403], ['Type DELETE', 400], ['unavailable in the current workspace', 404], ['Stored files must be removed', 409]];
  const match = known.find(([phrase]) => error.message.includes(phrase));
  return match ? NextResponse.json({ error: error.message }, { status: match[1] }) : NextResponse.json({ error: fallback }, { status: 500 });
}
