import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { safeEqual } from '@/lib/crypto';
import { jobDefinitions, type JobName } from '@/lib/scheduler/jobs';

/**
 * Run the worker's jobs over HTTP.
 *
 * For serverless deployments (Vercel Cron, Cloud Scheduler, crontab + curl)
 * where a long-lived worker is awkward. Run this *or* `npm run worker`, not
 * both — they cannot double-publish, since claiming is atomic, but it wastes
 * work.
 *
 * `?jobs=publish,rss` restricts the run, so publishing can be called every
 * minute while analytics runs hourly from a separate schedule.
 */
export const dynamic = 'force-dynamic';
/** Analytics over a large workspace is the slow one. */
export const maxDuration = 300;

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

  const requested = new URL(request.url).searchParams.get('jobs');
  const wanted = requested
    ? new Set(requested.split(',').map((name) => name.trim()) as JobName[])
    : null;

  const jobs = jobDefinitions().filter((job) => !wanted || wanted.has(job.name));
  const results: Record<string, string> = {};

  for (const job of jobs) {
    try {
      const summary = await job.run({
        now: new Date(),
        logger: (message, detail) => console.log(`[cron] [${job.name}] ${message}`, detail ?? ''),
      });
      results[job.name] = summary ?? 'nothing to do';
    } catch (error) {
      // One failing job must not abort the rest of the run.
      results[job.name] = `error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  return NextResponse.json({ ran: jobs.map((job) => job.name), results });
}
