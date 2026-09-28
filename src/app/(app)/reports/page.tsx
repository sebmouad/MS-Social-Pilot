import { getTranslations } from 'next-intl/server';

import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { buildReport, parseReportRange } from '@/lib/reports';
import { formatInZone, utcToLocalInput, appLocale } from '@/lib/time';
import { ReportControls } from '@/components/ReportControls';
import { ExternalLink } from '@/components/ExternalLink';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('reports.title');
}


export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requirePage();
  const t = await getTranslations('reports');
  const params = await searchParams;
  const timezone = auth.workspace.timezone;

  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  // The same parsing the CSV routes use, so the screen and the download can
  // never describe different periods — and so "1 August" means that day here,
  // not midnight UTC.
  const range = parseReportRange({
    from: first(params.from) ?? null,
    to: first(params.to) ?? null,
    timeZone: timezone,
  });
  // A rejected range must not quietly become a different one. Reporting the
  // last thirty days under dates nobody asked for is the failure this screen
  // is most able to hide: the numbers look real, and they are — for a period
  // the reader is not looking at.
  const rangeError = range.ok ? null : range.message;
  const { from, to } = range.ok
    ? range
    : { from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), to: new Date() };

  const report = rangeError
    ? null
    : await buildReport({ workspaceId: auth.workspace.id, timezone, from, to });

  const cards = report
    ? [
        { label: t('postsPublished'), value: report.postsPublished },
        { label: t('totalReach'), value: report.totals.reach },
        { label: t('totalEngagement'), value: report.totals.engagement },
        { label: t('linkClicks'), value: report.totals.linkClicks },
      ]
    : [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {t('subtitle')} · {formatInZone(from, timezone, 'd MMM yyyy')} –{' '}
            {formatInZone(to, timezone, 'd MMM yyyy')}
          </p>
        </div>
        <ReportControls
          from={utcToLocalInput(from, timezone).slice(0, 10)}
          to={utcToLocalInput(to, timezone).slice(0, 10)}
        />
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="card p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{card.value.toLocaleString(appLocale())}</p>
          </div>
        ))}
      </div>

      {rangeError ? (
        <div className="card p-8 text-center text-sm text-amber-700">{rangeError}</div>
      ) : !report || report.destinations.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-600">{t('noData')}</div>
      ) : (
        <>
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('byDestination')}</h2>
            {/* Wide table: scrolls inside its own container rather than the page. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3 font-medium">{t('destination')}</th>
                    {/* Not the headline figure: that counts posts, this counts
                        the times each destination was posted to, so one post to
                        three Pages is 1 up there and 1+1+1 here. Sharing a
                        label made the column look like broken arithmetic. */}
                    <th className="py-2 pr-3 text-right font-medium">{t('postsSent')}</th>
                    <th className="py-2 pr-3 text-right font-medium">Impressions</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('totalReach')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('totalEngagement')}</th>
                    <th className="py-2 text-right font-medium">{t('linkClicks')}</th>
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
                      <td className="py-2 pr-3 text-right text-slate-600">{row.reach.toLocaleString(appLocale())}</td>
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

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('topPosts')}</h2>
            <ol className="space-y-3">
              {report.topPosts.map((post, index) => (
                <li key={`${post.postId}-${index}`} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                  <p className="line-clamp-2 [overflow-wrap:anywhere] text-sm text-slate-800">{post.message || '—'}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {post.targetName}
                    {post.publishedLabel ? ` · ${post.publishedLabel}` : ''} ·{' '}
                    {post.engagement.toLocaleString(appLocale())} {t('totalEngagement').toLowerCase()}
                    {post.impressions > 0 && ` · ${post.impressions.toLocaleString(appLocale())} impressions`}
                    {post.url && (
                      <>
                        {' · '}
                        <ExternalLink href={post.url} className="text-brand-600 hover:underline">
                          Facebook
                        </ExternalLink>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      <p className="text-xs text-slate-500">
        Impressions, reach and engagement come from Facebook. Link clicks are counted by this app&apos;s
        own short links. They measure different things and are never added together.
      </p>
    </div>
  );
}
