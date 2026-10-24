import { NextResponse, type NextRequest } from 'next/server';
import { runtimeConfigBatch } from '@/server/config/store';
import { isAllowedWrite, isWriteMethod } from '@/server/cross-site-write';
import { resolveRedirect } from '@/lib/route-redirects';
import { LANGUAGE_COOKIE, chosenLanguage } from '@/lib/language';

/** A language chosen in the account menu outranks the browser's own Accept-Language. */
function next(request: NextRequest) {
  const language = chosenLanguage(request.cookies.get(LANGUAGE_COOKIE)?.value);
  if (!language) return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set('accept-language', language);
  return NextResponse.next({ request: { headers } });
}

/** Every route family and server-action POST passes through the same guard. */
export async function middleware(request: NextRequest) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    // Moved customer routes (declared by module manifests) redirect permanently, keeping the query string.
    const target = resolveRedirect(request.nextUrl.pathname, request.nextUrl.search);
    return target ? NextResponse.redirect(new URL(target, request.url), 308) : next(request);
  }
  if (!isWriteMethod(request.method)) return next(request);
  try {
    const policy = await runtimeConfigBatch(['app.publicOrigin', 'app.developmentOrigins']);
    if (!isAllowedWrite(request, {
      publicOrigin: policy['app.publicOrigin'] as string,
      developmentOrigins: policy['app.developmentOrigins'] as string[],
    })) {
      return NextResponse.json({ code: 'CROSS_SITE_WRITE_DENIED' }, { status: 403, headers: { 'cache-control': 'no-store' } });
    }
  } catch {
    // An unavailable/invalid security configuration must never allow a mutation.
    return NextResponse.json({ code: 'WRITE_ORIGIN_CHECK_UNAVAILABLE' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  return next(request);
}

// Node middleware is supported by the pinned Next 15.5 runtime; validated Root
// reads need Prisma/Node crypto. No path exemptions can bypass mutation checks.
export const config = { runtime: 'nodejs', matcher: '/:path*' };
