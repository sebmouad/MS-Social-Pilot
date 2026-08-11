import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

/**
 * Liveness and readiness for whatever is in front of this app.
 *
 * Unauthenticated on purpose — a load balancer, an uptime monitor and Docker's
 * own healthcheck all need it before anybody has signed in — so it says as
 * little as it can get away with. No version, no configuration, no error text:
 * a probe needs a status code, and anything else here is a detail handed to
 * everyone who can reach the port.
 *
 * The database round trip is what makes it worth having. A container that has
 * booted but cannot reach Postgres serves errors on every page, and a check
 * that only proves the process is alive would call that healthy — which is
 * also what let the worker start against a database the web container had not
 * finished migrating.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok' });
  } catch {
    return NextResponse.json({ status: 'unavailable' }, { status: 503 });
  }
}
