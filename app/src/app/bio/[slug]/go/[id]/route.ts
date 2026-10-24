import { clientIp } from '@/server/client-ip';
import { followBioLink } from '@/modules/sharing/server/bio';
export const dynamic = 'force-dynamic';

/** Count (bounded) and redirect. Unknown, disabled and suspended pages all answer the same 404. */
export async function GET(request: Request, context: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await context.params;
  let url: string | null = null;
  try { url = await followBioLink(slug, id, clientIp(request)); } catch { return new Response('Unavailable', { status: 503, headers: { 'cache-control': 'no-store' } }); }
  if (!url) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}
