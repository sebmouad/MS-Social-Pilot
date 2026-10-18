import { clientIp } from '@/server/client-ip';
import { readWorkspaceImage } from '@/server/media/storage';
import { linkShowsImage, resolvePublicLink } from '@/modules/sharing/server/public';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow' };
const plain = (status: number, text: string) => new Response(text, { status, headers });

/**
 * Preview of an uploaded image on a share page. The share token is the credential: the image is served only while
 * the link resolves and one of the posts it currently shows references that exact image. Every other case,
 * including a missing file, answers the same 404.
 */
export async function GET(request: Request, context: { params: Promise<{ token: string; id: string }> }) {
  try {
    const { token, id } = await context.params;
    const access = await resolvePublicLink(token, clientIp(request), 'media');
    if (!access.ok) return access.reason === 'rate_limited' ? plain(429, 'Too many requests') : plain(404, 'Not found');
    if (!(await linkShowsImage(access.value, id))) return plain(404, 'Not found');
    const image = await readWorkspaceImage(access.value.workspaceId, id.toLowerCase());
    return new Response(new Uint8Array(image.bytes), { headers: { ...headers, 'content-type': image.mimeType, 'content-length': String(image.bytes.length), 'content-disposition': 'inline', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } });
  } catch { return plain(404, 'Not found'); }
}
