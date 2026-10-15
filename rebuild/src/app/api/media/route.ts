import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { listWorkspaceImages, uploadWorkspaceImage } from '@/server/media/storage';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { runtimeConfig } from '@/server/config/store';
import { MediaBodyTooLarge, readBoundedImageForm } from '@/server/media/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'publishing/media', channelScoped: true }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  try {
    const limit = Number(await runtimeConfig('storage.mediaLibraryBatchLimit'));
    const cursor = new URL(request.url).searchParams.get('cursor') || undefined;
    const result = await listWorkspaceImages(viewer.workspaceId, { limit, cursor });
    return NextResponse.json(result, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status = message === 'Invalid media cursor.' ? 400 : /storage root/i.test(message) ? 503 : 500;
    return NextResponse.json({ error: status === 503 ? 'Image storage is not available right now.' : status === 500 ? 'Could not load images.' : message }, { status, headers: { 'cache-control': 'no-store' } });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  let viewer;
  try { viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true, write: true }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  try {
    const maxBytes = Number(await runtimeConfig('publishing.maxImageUploadBytes'));
    const overhead = Number(await runtimeConfig('publishing.maxImageUploadRequestOverheadBytes'));
    const form = await readBoundedImageForm(request, maxBytes + overhead);
    const file = form.get('imageFile');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Choose an image file.' }, { status: 400 });
    const image = await withWorkspaceOperation(viewer.workspaceId, () => uploadWorkspaceImage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, file));
    return NextResponse.json({ ...image, reference: `media:${image.id}`, url: `/api/media/${image.id}` }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status = error instanceof MediaBodyTooLarge ? 413 : /storage root/i.test(message) ? 503 : 400;
    return NextResponse.json({ error: status === 503 ? 'Image storage is not available right now.' : message }, { status, headers: { 'cache-control': 'no-store' } });
  }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
