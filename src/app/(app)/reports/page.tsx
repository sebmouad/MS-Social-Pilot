import Link from 'next/link';
import { TargetType } from '@prisma/client';
import { getTranslations } from 'next-intl/server';

import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { buildReport, parseReportRange } from '@/lib/reports';
import { parseRange } from '@/lib/date-range';
import { formatInZone, appLocale } from '@/lib/time';
import { ReportControls } from '@/components/ReportControls';
import { DateRangePicker } from '@/components/DateRangePicker';
import { ExternalLink } from '@/components/ExternalLink';
import { FeedPost } from '@/components/FeedPost';
import { PageAnalysisView } from '@/components/analysis/PageAnalysisView';
import { AudienceView } from '@/components/AudienceSection';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('reports.title');
}

const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A report for one Page over any period, as the scheduling tools write them:
 * how the Page did, what worked, who the audience is, and what was published
 * from here.
 *
 * It reads every post on the Page, not only those sent from this app: a
 * report that left out what was posted from the Facebook app would describe a
 * Page nobody runs. The period is the same picker as everywhere else, and the
 * CSV and the printout are built from the period on screen.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requirePage();
  const t = await getTranslations('reports');
  // Unscoped, for the `errors.*` key a refused range carries.
  const tAll = await getTranslations();
  const params = await searchParams;
  const timezone = auth.workspace.timezone;

  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const rawFrom = first(params.from);
  const rawTo = first(params.to);

  // A reversed pair of dates is refused, not quietly swapped: a report for a
  // period nobody asked for looks real, and is the failure this screen could
  // most easily hide.
  const checked =
    rawFrom && rawTo ? parseReportRange({ from: rawFrom, to: rawTo, timeZone: timezone }) : null;
  const rangeError =
    checked && !checked.ok
      ? tAll(checked.error.key, checked.error.params)
      : rawFrom && !BARE_DAY.test(rawFrom)
        ? tAll('errors.dateRange')
        : null;

  const range = parseRange(
    { range: first(params.range), from: rawFrom, to: rawTo, days: first(params.days) },
    timezone,
  );
  const { from, to } = range;

  const pages = await prisma.target.findMany({
    where: { workspaceId: auth.workspace.id, type: TargetType.page },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, pictureUrl: true, followersCount: true, fanCount: true },
  });
  const selected = pages.find((page) => page.id === first(params.target)) ?? pages[0] ?? null;

  const report = rangeError
    ? null
    : await buildReport({ workspaceId: auth.workspace.id, timezone, from, to });

  const cards = report
    ? [
        { label: t('postsPublished'), value: report.postsPublished },
        { label: t('totalReach'), value: report.totals.reach },
        { label: t('totalEngagement'), value: report.totals.engagement },
        { label: t('linkClicksLifetime'), value: report.totals.linkClicks },
      ]
    : [];

  const keep: Record<string, string> = selected ? { target: selected.id } : {};
  const pageHref = (id: string) =>
    `/reports?${new URLSearchParams({
      target: id,
      ...(range.key === 'custom' ? { from: range.fromDay, to: range.toDay } : { range: range.key }),
    }).toString()}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
        </div>
        <ReportControls from={range.fromDay} to={range.toDay} downloadable={!rangeError} />
      </header>

      <div className="filter-row print:hidden">
        <DateRangePicker range={range} path="/reports" keep={keep} />
        {pages.length > 1 && (
          <nav className="flex flex-wrap gap-2" aria-label={t('choosePage')}>
            {pages.map((page) => (
              <Link
                key={page.id}
                href={pageHref(page.id)}
                aria-current={page.id === selected?.id ? 'page' : undefined}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${
                  page.id === selected?.id
                    ? 'bg-brand-50 text-brand-600'
                    : 'bg-white text-slate-700 shadow-surface hover:bg-slate-50'
                }`}
              >
                {page.name}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {rangeError ? (
        <div className="card p-8 text-center text-sm text-amber-700">{rangeError}</div>
      ) : (
        <>
          {selected && (
            <>
              {/* The cover: what this is, for whom and for when — the first
                  thing a client sees on the printout. */}
              <section className="card flex flex-wrap items-center gap-4 p-5">
                {selected.pictureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selected.pictureUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
                ) : (
                  <span
                    aria-hidden
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-xl font-bold text-brand-600"
                  >
                    {selected.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-bold text-slate-900">{t('coverTitle', { page: selected.name })}</h2>
                  <p className="text-sm text-slate-600">
                    {formatInZone(from, timezone, 'd MMMM yyyy')} – {formatInZone(to, timezone, 'd MMMM yyyy')}
                  </p>
                </div>
                <p className="text-xs text-slate-500">
                  {t('generatedOn', { date: formatInZone(new Date(), timezone, 'd MMMM yyyy, HH:mm') })}
                </p>
              </section>

              <PageAnalysisView
                workspaceId={auth.workspace.id}
                targetId={selected.id}
                from={from}
                to={to}
                days={range.days}
                timeZone={timezone}
              />

              <section aria-labelledby="report-audience" className="space-y-4">
                <h2 id="report-audience" className="text-[17px] font-bold text-slate-900">
                  {t('audienceTitle')}
                </h2>
                <AudienceView targetId={selected.id} from={from} to={to} timeZone={timezone} />
              </section>
            </>
          )}

          <section aria-labelledby="report-published" className="space-y-4">
            <div>
              <h2 id="report-published" className="text-[17px] font-bold text-slate-900">
                {t('publishedHere')}
              </h2>
              <p className="text-sm text-slate-600">{t('publishedHereHint')}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {cards.map((card) => (
                <div key={card.label} className="card p-4">
                  <p className="text-[13px] font-semibold text-slate-600">{card.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">
                    {card.value.toLocaleString(appLocale())}
                  </p>
                </div>
              ))}
            </div>

            {!report || report.destinations.length === 0 ? (
              <div className="card p-8 text-center text-sm text-slate-600">{t('noData')}</div>
            ) : (
              <>
                <section className="card p-5">
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">{t('byDestination')}</h3>
                  {/* Wide table: scrolls inside its own container rather than the page. */}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[42rem] text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-[13px] font-semibold text-slate-600">
                          <th scope="col" className="py-2 pr-3 font-medium">{t('destination')}</th>
                          {/* Not the headline figure: that counts posts, this counts
                              the times each destination was posted to, so one post
                              to three Pages is 1 up there and 1+1+1 here. */}
                          <th scope="col" className="py-2 pr-3 text-right font-medium">{t('postsSent')}</th>
                          <th scope="col" className="py-2 pr-3 text-right font-medium">{t('impressions')}</th>
                          <th scope="col" className="py-2 pr-3 text-right font-medium">{t('totalReach')}</th>
                          <th scope="col" className="py-2 pr-3 text-right font-medium">{t('totalEngagement')}</th>
                          <th scope="col" className="py-2 text-right font-medium">{t('linkClicksLifetime')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.destinations.map((row) => (
                          <tr key={row.targetId} className="border-b border-slate-100 last:border-0">
                            <td className="py-2 pr-3 font-medium text-slate-800">{row.name}</td>
                            <td className="py-2 pr-3 text-right text-slate-600">{row.posts}</td>
                            <td className="py-2 pr-3 text-right text-slate-600">
                              {row.impressions.toLocaleString(appLocale())}
                            </td>
                            <td className="py-2 pr-3 text-right text-slate-600">
                              {row.reach.toLocaleString(appLocale())}
                            </td>
                            <td className="py-2 pr-3 text-right text-slate-600">
                              {(row.reactions + row.comments + row.shares).toLocaleString(appLocale())}
                            </td>
                            <td className="py-2 text-right text-slate-600">{row.clicks.toLocaleString(appLocale())}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="px-1 text-[17px] font-bold text-slate-900">{t('topPosts')}</h3>
                  {/* The posts themselves, as the Page's followers saw them. */}
                  <ol className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {report.topPosts.map((post, index) => (
                      <li key={post.postId} className="break-inside-avoid">
                        <FeedPost
                          compact
                          clamp
                          author={{
                            name: post.destinations.map((destination) => destination.name).join(', '),
                            pictureUrl: post.destinations[0]?.pictureUrl ?? null,
                          }}
                          meta={post.publishedLabel ?? '—'}
                          badge={
                            <span className="nums rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                              #{index + 1}
                            </span>
                          }
                          message={post.message}
                          emptyText="—"
                          images={post.imageUrl ? [{ url: post.imageUrl }] : []}
                          link={post.link}
                          footer={
                            <p className="flex flex-wrap items-center gap-x-2 px-1 py-1 text-[13px] text-slate-600">
                              <span className="font-semibold text-slate-900">
                                {t('engagementCount', { count: post.engagement })}
                              </span>
                              {post.impressions > 0 && <span>· {t('impressionCount', { count: post.impressions })}</span>}
                              {/* Each destination by name, linked to the post there:
                                  one entry per post, however many Pages it went to. */}
                              {post.destinations.map((destination, index) =>
                                destination.url ? (
                                  <ExternalLink
                                    key={`${destination.name}-${index}`}
                                    href={destination.url}
                                    className="text-brand-600 hover:underline"
                                  >
                                    · {destination.name}
                                  </ExternalLink>
                                ) : null,
                              )}
                            </p>
                          }
                        />
                      </li>
                    ))}
                  </ol>
                </section>
              </>
            )}
          </section>
        </>
      )}

      <p className="text-xs text-slate-500">{t('sourceNote')}</p>
    </div>
  );
}
