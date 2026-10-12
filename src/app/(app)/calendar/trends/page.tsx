import { ScreenHeader } from '@/components/ScreenHeader';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { TrendKeywords } from '@/components/TrendKeywords';
import { requirePage } from '@/lib/auth';
import { audienceOf, effectiveAudience } from '@/lib/audience';
import { canManageSettings } from '@/lib/constants';
import { screenMetadata } from '@/lib/metadata';
import { ChannelsLayout } from '@/components/ChannelsLayout';
import { loadPageFilter } from '@/lib/page-filter';
import { prisma } from '@/lib/prisma';
import { matchesKeywords, trendsFor } from '@/lib/trends';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('trends.title');
}

/**
 * Trending topics (NEXT_PHASES H7): today's searches in each country the
 * selected Pages' audiences name, kept to the team's words when it set some.
 * Reads what the worker stored; "Make a post" opens Compose with the topic.
 */
export default async function TrendsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requirePage();
  const t = await getTranslations('trends');
  const locale = await getLocale();
  const params = await searchParams;
  const filter = await loadPageFilter(auth, params);
  const showAll = params.all === '1';

  const [workspace, targets] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({
      where: { id: auth.workspace.id },
      select: { trendKeywords: true, audienceCountries: true, audienceLanguages: true, audienceTimezone: true, audienceCalendars: true },
    }),
    prisma.target.findMany({
      where: { workspaceId: auth.workspace.id, id: { in: filter.ids } },
      select: { id: true, name: true, audienceCountries: true, audienceLanguages: true, audienceTimezone: true, audienceCalendars: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  // Each country, with the first selected Page whose audience is there.
  const pageFor = new Map<string, string>();
  for (const target of targets) {
    for (const country of effectiveAudience(audienceOf(target), audienceOf(workspace), auth.workspace.timezone).countries) {
      if (!pageFor.has(country)) pageFor.set(country, target.id);
    }
  }
  const countries = [...pageFor.keys()].sort();
  const keywords = workspace.trendKeywords;
  const trends = await trendsFor(countries);
  const shown = showAll ? trends : trends.filter((trend) => matchesKeywords(trend, keywords));
  const regions = new Intl.DisplayNames([locale], { type: 'region' });
  const hidden = trends.length - shown.length;

  return (
    <ChannelsLayout auth={auth} selection={filter}>
    <div className="min-w-0 flex-1 space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('intro')} />

      <TrendKeywords keywords={keywords} canEdit={canManageSettings(auth.role)} />

      {countries.length === 0 ? (
        <EmptyState
          icon="globe"
          title={t('noCountries')}
          hint={t('noCountriesHint')}
          action={
            <Link href="/settings/pages" className="btn-secondary">
              {t('setAudience')}
            </Link>
          }
        />
      ) : trends.length === 0 ? (
        <EmptyState icon="trendUp" title={t('none')} hint={t('noneHint')} />
      ) : (
        <>
          {hidden > 0 && (
            <p className="text-sm text-slate-600">
              {t('hidden', { count: hidden })}{' '}
              <Link href={`?${new URLSearchParams({ ...flat(params), all: '1' })}`} className="font-medium text-brand-600 hover:underline">
                {t('showAll')}
              </Link>
            </p>
          )}
          {shown.length === 0 && <EmptyState icon="search" title={t('noMatch')} hint={t('noMatchHint')} />}
          {countries.map((country) => {
            const list = shown.filter((trend) => trend.country === country);
            if (list.length === 0) return null;
            return (
              <section key={country} aria-labelledby={`trends-${country}`} className="card p-5">
                <h2 id={`trends-${country}`} className="text-sm font-semibold text-slate-900">
                  {regions.of(country) ?? country}
                </h2>
                <ul className="mt-3 divide-y divide-slate-100">
                  {list.map((trend) => (
                    <li key={trend.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900">{trend.title}</p>
                        <p className="text-xs text-slate-500">
                          {trend.traffic && t('searches', { traffic: trend.traffic })}
                          {trend.traffic && trend.newsUrl && ' · '}
                          {trend.newsUrl && (
                            <a href={trend.newsUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                              {trend.newsTitle ?? t('news')}
                              <Icon name="external" size={11} className="ms-1 inline" />
                            </a>
                          )}
                        </p>
                      </div>
                      <Link
                        href={`/compose?${new URLSearchParams({ text: trend.title, to: pageFor.get(country)! })}`}
                        className="btn-secondary text-xs"
                        aria-label={t('makePostAbout', { topic: trend.title })}
                      >
                        <Icon name="compose" size={14} />
                        {t('makePost')}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </div>
    </ChannelsLayout>
  );
}

function flat(params: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : [])));
}
