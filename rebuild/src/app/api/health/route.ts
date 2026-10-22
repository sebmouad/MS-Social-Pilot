import { NextResponse } from 'next/server';
import { readSystemHealth } from '@/modules/history/server/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness and readiness for whatever sits in front of the app. Unauthenticated on purpose (proxies, uptime monitors and
 * deploy scripts need it before anyone signs in), so it says as little as possible: a status code and the worker state.
 * The code is this process's health; a monitor that should alert on a stopped worker reads `worker.status`.
 */
export async function GET() {
  const health = await readSystemHealth();
  const headers = { 'cache-control': 'no-store' };
  if (!health.database) return NextResponse.json({ status: 'unavailable' }, { status: 503, headers });
  return NextResponse.json({ status: 'ok', worker: health.worker }, { headers });
}
