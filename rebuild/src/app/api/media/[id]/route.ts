import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { deleteUnusedWorkspaceImage, readWorkspaceImage } from '@/modules/publishing/server/media/storage';
import { withWorkspaceOperation } from '@/server/data-control/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'publishing/media', channelScoped: true }); }
  catch {
    try { viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true }); }
    catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  }
  try {
    const { id } = await params;
    const image = await readWorkspaceImage(viewer.workspaceId, id);
    return new NextResponse(new Uint8Array(image.bytes), { headers: { 'content-type': image.mimeType, 'content-length': String(image.bytes.length), 'content-disposition': 'inline', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Image not found.' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  let viewer;
  try { viewer = await requireViewer({ feature: 'publishing/media', channelScoped: true, write: true }); }
  catch {
    try { viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true, write: true }); }
    catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  }
  try {
    const { id } = await params;
    const outcome = await withWorkspaceOperation(viewer.workspaceId, () => deleteUnusedWorkspaceImage(viewer.workspaceId, id));
    if (outcome === 'in_use') return NextResponse.json({ error: 'This image is attached to a post and cannot be deleted.' }, { status: 409 });
    if (outcome === 'missing') return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status = message === 'Invalid media ID.' ? 400 : 404;
    return NextResponse.json({ error: status === 400 ? message : 'Image not found.' }, { status, headers: { 'cache-control': 'no-store' } });
  }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
