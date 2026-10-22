import { NextResponse, type NextRequest } from 'next/server';
import { runtimeConfigBatch } from '@/server/config/store';
import { isAllowedWrite, isWriteMethod } from '@/server/cross-site-write';

/** Every route family and server-action POST passes through the same guard. */
export async function middleware(request: NextRequest) {
  if (!isWriteMethod(request.method)) return NextResponse.next();
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
  return NextResponse.next();
}

// Node middleware is supported by the pinned Next 15.5 runtime; validated Root
// reads need Prisma/Node crypto. No path exemptions can bypass mutation checks.
export const config = { runtime: 'nodejs', matcher: '/:path*' };
