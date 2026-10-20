import { requestOrigin } from '@/server/request-origin';
import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { listWorkspaceImages, uploadWorkspaceImage } from '@/modules/publishing/server/media/storage';
import { mediaHolderVisibility } from '@/modules/publishing/server/media-holders';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { runtimeConfig } from '@/server/config/store';
import { MediaBodyTooLarge, readBoundedImageForm } from '@/modules/publishing/server/media/body';
import { MediaStorageUnavailable, MediaValidationError } from '@/modules/publishing/server/media/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'publishing/media', channelScoped: true }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401, headers: { 'cache-control': 'no-store' } }); }
  try {
    const limit = Number(await runtimeConfig('storage.mediaLibraryBatchLimit'));
    const cursor = new URL(request.url).searchParams.get('cursor') || undefined;
    const result = await listWorkspaceImages(viewer.workspaceId, { limit, cursor, holderVisibility: await mediaHolderVisibility(viewer) });
    return NextResponse.json(result, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof MediaStorageUnavailable) return NextResponse.json({ error: error.message }, { status: 503, headers: { 'cache-control': 'no-store' } });
    if (error instanceof MediaValidationError && error.code === 'invalid_cursor') return NextResponse.json({ error: error.message }, { status: 400, headers: { 'cache-control': 'no-store' } });
    return NextResponse.json({ error: 'Could not load images. Please try again.' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403, headers: { 'cache-control': 'no-store' } });
  let viewer;
  try { viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true, write: true }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401, headers: { 'cache-control': 'no-store' } }); }
  try {
    const maxBytes = Number(await runtimeConfig('publishing.maxImageUploadBytes'));
    const overhead = Number(await runtimeConfig('publishing.maxImageUploadRequestOverheadBytes'));
    const form = await readBoundedImageForm(request, maxBytes + overhead);
    const file = form.get('imageFile');
    if (!(file instanceof File)) throw new MediaValidationError('invalid_file');
    const image = await withWorkspaceOperation(viewer.workspaceId, () => uploadWorkspaceImage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, file));
    return NextResponse.json({ ...image, reference: `media:${image.id}`, url: `/api/media/${image.id}` }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof MediaBodyTooLarge) return NextResponse.json({ error: error.message }, { status: 413, headers: { 'cache-control': 'no-store' } });
    if (error instanceof MediaStorageUnavailable) return NextResponse.json({ error: error.message }, { status: 503, headers: { 'cache-control': 'no-store' } });
    if (error instanceof MediaValidationError && error.code !== 'invalid_limit' && error.code !== 'invalid_listing_limit' && error.code !== 'invalid_cursor') return NextResponse.json({ error: error.message }, { status: 400, headers: { 'cache-control': 'no-store' } });
    return NextResponse.json({ error: 'Could not save this image. Please try again.' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}
