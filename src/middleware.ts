import { NextResponse, type NextRequest } from 'next/server';

import { isCrossSiteWrite } from './lib/cross-site';
import { METHOD_HEADER, PATHNAME_HEADER } from './lib/modules';
import { RETURN_COOKIE } from './lib/invite-path';

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
  headers.set(METHOD_HEADER, request.method);
  const response = NextResponse.next({ request: { headers } });
  // An assistant's consent link opened while signed out: remember it, so
  // signing in comes back here instead of the dashboard (`afterAuthPath`).
  // The page itself sends the visitor to sign in.
  if (pathname === '/oauth/authorize' && !request.cookies.has('msp_session')) {
    response.cookies.set(RETURN_COOKIE, `${pathname}${request.nextUrl.search}`, { path: '/', maxAge: 600, sameSite: 'lax' });
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
