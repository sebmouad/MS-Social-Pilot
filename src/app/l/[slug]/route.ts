import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { isProbablyBot, recordClick } from '@/lib/links';

/**
 * Short link redirect.
 *
 * Deliberately a plain 302 with no HTML body. Facebook fetches this URL when
 * building a post's preview card, and anything other than an immediate
 * redirect to the real page — an interstitial, a JavaScript bounce, a 200 with
 * a meta refresh — leaves the post with a blank card.
 *
 * Clicks are recorded before redirecting, but a failure to record must never
 * cost the visitor their redirect.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await context.params;

  const link = await prisma.shortLink.findUnique({ where: { slug } });
  if (!link) {
    return NextResponse.json({ error: 'This link does not exist.' }, { status: 404 });
  }

  const userAgent = request.headers.get('user-agent');

  // Facebook's scraper hits every shortened link at publish time; counting it
  // would give each post a click it did not earn.
  if (!isProbablyBot(userAgent)) {
    try {
      await recordClick({
        shortLinkId: link.id,
        ip:
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
          request.headers.get('x-real-ip'),
        userAgent,
        referer: request.headers.get('referer'),
      });
    } catch (error) {
      console.error('[shortlink] could not record click', error);
    }
  }

  return NextResponse.redirect(link.targetUrl, {
    status: 302,
    // Never cache: the click must reach us on every visit.
    headers: { 'cache-control': 'no-store, max-age=0' },
  });
}
