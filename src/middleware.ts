import { NextResponse, type NextRequest } from 'next/server';

import { isCrossSiteWrite } from './lib/cross-site';
import { PATHNAME_HEADER } from './lib/modules';

/**
 * Refuse API writes another site started. See `src/lib/cross-site.ts`.
 *
 * API routes only: pages are reads, and a form another site submits to one of
 * them does nothing a link would not.
 *
 * Every request also carries its path to server code (`PATHNAME_HEADER`), so
 * modules root switched off are refused in one place (`src/lib/auth.ts`).
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/api/') && isCrossSiteWrite(request.method, request.headers.get('sec-fetch-site'))) {
    return NextResponse.json({ error: 'Cross-site requests are not accepted.' }, { status: 403 });
  }
  const headers = new Headers(request.headers);
  headers.set(PATHNAME_HEADER, pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
