import { requestOrigin } from '@/server/request-origin';
import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { deleteUnusedWorkspaceImage, readWorkspaceImage } from '@/modules/publishing/server/media/storage';
import { verifyMediaShare } from '@/modules/publishing/server/media/signed-urls';
import { runtimeSecret } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A valid signed grant serves one stored image without a session, so providers that fetch
  // attachments by URL can read publish-time bytes. Every signed failure answers 404, like the
  // share preview route, so grants cannot be probed apart. The session path below is unchanged.
  const query = new URL(request.url).searchParams;
  const ws = query.get('ws');
  const exp = query.get('exp');
  const sig = query.get('sig');
  if (ws !== null || exp !== null || sig !== null) {
    try {
      const secret = await runtimeSecret('publishing.mediaShareSecret');
      const grant = { workspaceId: ws ?? '', id, exp: Number(exp), sig: sig ?? '' };
      if (!secret || !verifyMediaShare(grant, secret)) return NextResponse.json({ error: 'Image not found.' }, { status: 404, headers: { 'cache-control': 'no-store' } });
      const image = await readWorkspaceImage(grant.workspaceId, id);
      return new NextResponse(new Uint8Array(image.bytes), { headers: { 'content-type': image.mimeType, 'content-length': String(image.bytes.length), 'content-disposition': 'inline', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' } });
    } catch {
      return NextResponse.json({ error: 'Image not found.' }, { status: 404, headers: { 'cache-control': 'no-store' } });
    }
  }
  let viewer;
  try { viewer = await requireViewer({ feature: 'publishing/media', channelScoped: true }); }
  catch {
    try { viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true }); }
    catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  }
  try {
    const image = await readWorkspaceImage(viewer.workspaceId, id);
    // Stored images are written once under a new id and never rewritten, so the viewer's browser may keep them.
    return new NextResponse(new Uint8Array(image.bytes), { headers: { 'content-type': image.mimeType, 'content-length': String(image.bytes.length), 'content-disposition': 'inline', 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=31536000, immutable' } });
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
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}
