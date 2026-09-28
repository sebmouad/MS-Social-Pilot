import { NextResponse, type NextRequest } from 'next/server';

import { isCrossSiteWrite } from './lib/cross-site';

/**
 * Refuse API writes another site started. See `src/lib/cross-site.ts`.
 *
 * API routes only: pages are reads, and a form another site submits to one of
 * them does nothing a link would not.
 */
export function middleware(request: NextRequest): NextResponse {
  if (isCrossSiteWrite(request.method, request.headers.get('sec-fetch-site'))) {
    return NextResponse.json({ error: 'Cross-site requests are not accepted.' }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
