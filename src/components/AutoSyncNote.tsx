import { getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import type { JobName } from '@/lib/scheduler/jobs';
import { formatInZone } from '@/lib/time';

/**
 * Where a screen's Facebook data comes from: the worker reads it on its own,
 * and this says when it last did. Replaces the "pull from Facebook" buttons,
 * which spent the app's call allowance on demand.
 */
export async function AutoSyncNote({
  job,
  timezone,
  firstReadPending = false,
}: {
  job: JobName;
  timezone: string;
  /** The Page was just connected and the worker has not read it yet. */
  firstReadPending?: boolean;
}) {
  const t = await getTranslations('autoSync');
  if (firstReadPending) return <p className="text-xs text-slate-500">{t('firstRead')}</p>;

  const run = await prisma.workerJobRun.findUnique({ where: { name: job }, select: { finishedAt: true } });
  return (
    <p className="text-xs text-slate-500">
      {run?.finishedAt ? t('updated', { when: formatInZone(run.finishedAt, timezone) }) : t('pending')}
    </p>
  );
}
