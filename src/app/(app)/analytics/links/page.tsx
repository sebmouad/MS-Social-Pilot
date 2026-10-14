import { ScreenHeader } from '@/components/ScreenHeader';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';

import { DateRangePicker } from '@/components/DateRangePicker';
import { EmptyState } from '@/components/EmptyState';
import { LinkClicksChart } from '@/components/LinkClicksChart';
import { ChannelsLayout } from '@/components/ChannelsLayout';
import { StatTile } from '@/components/charts/StatTile';
import { requirePage } from '@/lib/auth';
import { parseRange } from '@/lib/date-range';
import { loadLinkClicks } from '@/lib/link-analytics';
import { screenMetadata } from '@/lib/metadata';
import { loadSelection } from '@/lib/page-filter';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('linkClicks.title');
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Every day of the range, so a day without clicks shows as zero rather than a gap. */
function everyDay(fromDay: string, toDay: string, clicks: Array<{ day: string; clicks: number }>) {
  const byDay = new Map(clicks.map((row) => [row.day, row.clicks]));
  const days: Array<{ day: string; clicks: number }> = [];
  for (let day = new Date(`${fromDay}T00:00:00Z`); day <= new Date(`${toDay}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    const key = day.toISOString().slice(0, 10);
    days.push({ day: key, clicks: byDay.get(key) ?? 0 });
  }
  return days;
}

/**
 * Short-link clicks: per day, Page, article and post, with
 * clicks per 1,000 views. Follows the shared profile selection and the period.
 */
export default async function LinkClicksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requirePage();
  const t = await getTranslations('linkClicks');
  const format = await getFormatter();
  const params = await searchParams;
  const selection = await loadSelection(auth, params);
  const timezone = auth.workspace.timezone;
  const range = parseRange(
    { range: first(params.range) ?? '30d', from: first(params.from), to: first(params.to), days: first(params.days) },
    timezone,
  );

  const [report, workspace] = await Promise.all([
    loadLinkClicks({
      workspaceId: auth.workspace.id,
      from: range.from,
      to: range.to,
      timezone,
      targetIds: selection.scope.all ? null : selection.scope.ids,
    }),
    prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspace.id }, select: { shortenerEnabled: true } }),
  ]);
  const number = (value: number) => format.number(value);
  const keep = Object.fromEntries(new URLSearchParams(selection.query));

  return (
    <ChannelsLayout auth={auth} selection={selection} tools={<DateRangePicker range={range} path="/analytics/links" keep={keep} />}>
    <div className="min-w-0 flex-1 space-y-6">
      <ScreenHeader
        title={t('title')}
        subtitle={t('intro')}
      />

      {report.total === 0 ? (
        <EmptyState
          icon="link"
          title={t('emptyTitle')}
          hint={workspace.shortenerEnabled ? t('emptyHint') : t('emptyHintOff')}
          action={
            workspace.shortenerEnabled ? (
              <Link className="btn-primary" href="/compose">
                {t('emptyAction')}
              </Link>
            ) : (
              <Link className="btn-primary" href="/settings">
                {t('turnOn')}
              </Link>
            )
          }
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label={t('total')} value={number(report.total)} />
            <StatTile label={t('pages')} value={number(report.byPage.length)} />
            <StatTile label={t('articles')} value={number(report.byArticle.length)} />
          </div>

          <LinkClicksChart
            title={t('perDay')}
            dateLabel={t('date')}
            clicksLabel={t('clicks')}
            points={everyDay(range.fromDay, range.toDay, report.byDay)}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card p-4" aria-labelledby="clicks-pages">
              <h2 id="clicks-pages" className="text-sm font-semibold text-slate-900">
                {t('byPage')}
              </h2>
              <table className="data-table mt-2 w-full text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="py-1.5 text-start font-medium">{t('page')}</th>
                    <th scope="col" className="py-1.5 text-end font-medium">{t('clicks')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.byPage.map((row) => (
                    <tr key={row.targetId}>
                      <td className="py-1.5 text-slate-800">{row.name}</td>
                      <td className="nums py-1.5 text-end text-slate-700">{number(row.clicks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="card p-4" aria-labelledby="clicks-articles">
              <h2 id="clicks-articles" className="text-sm font-semibold text-slate-900">
                {t('topArticles')}
              </h2>
              <table className="data-table mt-2 w-full table-fixed text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="py-1.5 text-start font-medium">{t('article')}</th>
                    <th scope="col" className="w-20 py-1.5 text-end font-medium">{t('clicks')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.byArticle.map((row) => (
                    <tr key={row.url}>
                      <td className="truncate py-1.5">
                        <a className="text-brand-700 hover:underline" href={row.url} target="_blank" rel="noreferrer" title={row.url}>
                          {row.url.replace(/^https?:\/\//, '')}
                        </a>
                      </td>
                      <td className="nums py-1.5 text-end text-slate-700">{number(row.clicks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <section className="card p-4" aria-labelledby="clicks-posts">
            <h2 id="clicks-posts" className="text-sm font-semibold text-slate-900">
              {t('topPosts')}
            </h2>
            <p className="hint">{t('perThousandHint')}</p>
            <div className="scroll-x">
              <table className="data-table mt-2 w-full min-w-[32rem] text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="py-1.5 text-start font-medium">{t('post')}</th>
                    <th scope="col" className="py-1.5 text-end font-medium">{t('clicks')}</th>
                    <th scope="col" className="py-1.5 text-end font-medium">{t('views')}</th>
                    <th scope="col" className="py-1.5 text-end font-medium">{t('perThousand')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.byPost.map((row) => (
                    <tr key={row.postId}>
                      <td className="max-w-xs truncate py-1.5">
                        {row.postTargetId ? (
                          <Link className="text-slate-800 hover:underline" href={`/analytics/post/${row.postTargetId}`}>
                            {row.message.split('\n')[0] || t('untitled')}
                          </Link>
                        ) : (
                          <span className="text-slate-800">{row.message.split('\n')[0] || t('untitled')}</span>
                        )}
                      </td>
                      <td className="nums py-1.5 text-end text-slate-700">{number(row.clicks)}</td>
                      <td className="nums py-1.5 text-end text-slate-700">{row.views > 0 ? number(row.views) : '—'}</td>
                      <td className="nums py-1.5 text-end text-slate-700">
                        {row.perThousand === null ? '—' : format.number(row.perThousand, { maximumFractionDigits: 1 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
    </ChannelsLayout>
  );
}
