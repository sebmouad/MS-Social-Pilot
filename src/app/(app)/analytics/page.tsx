import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { TargetType } from '@prisma/client';

import { AnalyticsClient } from '@/components/AnalyticsClient';
import { PagePicker } from '@/components/PagePicker';
import { requirePage } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { readAvailability, readStoredAnalytics } from '@/lib/analytics';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requirePage();
  const t = await getTranslations('analytics');
  const params = await searchParams;
  const timezone = auth.workspace.timezone;

  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  // Groups have no insights edge, so they are not offered here at all.
  const pages = await prisma.target.findMany({
    where: { workspaceId: auth.workspace.id, type: TargetType.page },
    orderBy: { name: 'asc' },
  });

  if (pages.length === 0) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
        </header>
        <div className="card p-8 text-center">
          <p className="text-sm text-slate-600">{t('noPages')}</p>
          <Link href="/accounts" className="btn-primary mt-4 inline-flex">
            {t('connect')}
          </Link>
        </div>
      </div>
    );
  }

  const requested = first(params.target);
  const selected = pages.find((page) => page.id === requested) ?? pages[0]!;

  const days = Number.parseInt(first(params.days) ?? '30', 10);
  const window = Number.isFinite(days) && days > 0 && days <= 365 ? days : 30;
  const to = new Date();
  const from = new Date(to.getTime() - window * 24 * 60 * 60 * 1000);

  const [series, availability] = await Promise.all([
    readStoredAnalytics({ targetId: selected.id, from, to }),
    readAvailability(selected.id),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {t('subtitle')} · {formatInZone(from, timezone, 'd MMM')} –{' '}
            {formatInZone(to, timezone, 'd MMM yyyy')}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <PagePicker
            pages={pages.map((page) => ({ id: page.id, name: page.name }))}
            selectedId={selected.id}
            days={window}
          />

          <div className="flex gap-1">
            {[7, 30, 90].map((option) => (
              <Link
                key={option}
                href={`/analytics?target=${selected.id}&days=${option}`}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  option === window ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {t('lastDays', { count: option })}
              </Link>
            ))}
          </div>
        </div>
      </header>

      <AnalyticsClient
        targetId={selected.id}
        targetName={selected.name}
        series={series}
        availability={availability.map((entry) => ({
          metric: entry.metric,
          label: entry.label,
          period: entry.period,
          available: entry.available,
          reason: entry.reason,
          description: entry.description,
        }))}
        profile={{
          fanCount: selected.fanCount,
          followersCount: selected.followersCount,
          talkingAboutCount: selected.talkingAboutCount,
          syncedLabel: selected.profileSyncedAt
            ? formatInZone(selected.profileSyncedAt, timezone)
            : null,
        }}
      />
    </div>
  );
}
