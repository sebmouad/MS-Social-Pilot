import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

import { readWorkerStatus } from './worker';

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
 *
 * The worker's state rides along as information, never as the verdict. The
 * status code is this container's health: Docker restarts `web` on a failing
 * check, which cannot fix a stopped worker, and the worker itself waits for
 * `web` to be healthy before starting — so a verdict that included it could
 * never turn green on a first boot. A monitor that should alert on a stopped
 * worker reads `worker.status` from the body.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json({ status: 'unavailable' }, { status: 503 });
  }

  // A failure here, with the database answering, is a missing table — a
  // migration that has not run yet — and says nothing about this container.
  const worker = await readWorkerStatus().catch(() => ({
    status: 'unknown' as const,
    lastBeatSeconds: null,
  }));

  return NextResponse.json({ status: 'ok', worker });
}
