import { countShortLinkRequest, resolveShortLink } from '@/modules/publishing/server/short-links';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };
async function redirect(request: Request, context: { params: Promise<{ slug: string }> }, count: boolean) {
  try {
    const destination = await resolveShortLink((await context.params).slug, count && countShortLinkRequest(request.headers.get('user-agent')));
    return destination ? new Response(null, { status: 302, headers: { ...headers, Location: destination } })
      : new Response(count ? 'Link not available / Lien non disponible' : null, { status: 404, headers });
  } catch {
    return new Response(count ? 'Try again later / Réessayez plus tard' : null, { status: 503, headers });
  }
}
export const GET = (request: Request, context: { params: Promise<{ slug: string }> }) => redirect(request, context, true);
export const HEAD = (request: Request, context: { params: Promise<{ slug: string }> }) => redirect(request, context, false);
