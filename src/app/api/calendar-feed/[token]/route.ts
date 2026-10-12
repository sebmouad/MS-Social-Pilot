import { renderFeed } from '@/lib/calendar-feeds';

/**
 * The private ICS address a calendar app polls (H19). No session: the token is
 * the authority, and an unknown or revoked one is a plain 404.
 */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const body = token.length >= 20 ? await renderFeed(token.replace(/\.ics$/, '')) : null;
  if (body === null) return new Response('Not found', { status: 404 });
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="calendar.ics"',
      'cache-control': 'private, max-age=300',
    },
  });
}
