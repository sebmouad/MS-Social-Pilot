import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { safeEqual } from '@/lib/crypto';
import { runSchedulerTick } from '@/lib/scheduler/runner';

/**
 * Run one scheduler pass over HTTP.
 *
 * This exists for serverless deployments (Vercel Cron, Cloud Scheduler, a
 * plain `curl` from crontab) where a long-lived worker process is awkward. It
 * does exactly what `npm run worker` does per tick — run one or the other, not
 * both, or two schedulers will compete for the same rows. They will not
 * double-post if you do (claiming is atomic), but it wastes work.
 *
 * Authenticated with a bearer token because it is an unauthenticated route
 * from the app's point of view.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const secret = env.cronSecret;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured, so this endpoint is disabled.' },
      { status: 404 },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const result = await runSchedulerTick({
    logger: (message, detail) => console.log(`[cron] ${message}`, detail ?? ''),
  });

  return NextResponse.json(result);
}
