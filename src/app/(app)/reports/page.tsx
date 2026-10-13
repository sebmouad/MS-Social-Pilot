import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import Link from 'next/link';
import { TargetType, WorkspaceRole } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { loadSelection } from '@/lib/page-filter';
import { ChannelsLayout } from '@/components/ChannelsLayout';

import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { buildReport, parseReportRange } from '@/lib/reports';
import { parseRange } from '@/lib/date-range';
import { formatInZone, appLocale } from '@/lib/time';
import { PhoneFold } from '@/components/PhoneFold';
import { ReportControls } from '@/components/ReportControls';
import { ReportBuilder } from '@/components/ReportBuilder';
import { GoalsView } from '@/components/GoalsView';
import { readGoals } from '@/lib/page-goals';
import { ResponseTimeView } from '@/components/analysis/ResponseTimeView';
import { ReportTemplates } from '@/components/ReportTemplates';
import { ReportSchedules } from '@/components/ReportSchedules';
import { parseSections } from '@/lib/report-sections';
import { atLeast, canManageSettings } from '@/lib/constants';
import { targetScope } from '@/lib/page-access';
import { DateRangePicker } from '@/components/DateRangePicker';
import { ExternalLink } from '@/components/ExternalLink';
import { aiAvailable } from '@/lib/ai';
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
  // Follows the shared profile selection (src/lib/page-filter.ts).
  const selection = await loadSelection(auth, params);
  const pageScope = selection.scope;
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
    where: { workspaceId: auth.workspace.id, type: TargetType.page, ...targetScope(pageScope) },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, pictureUrl: true, followersCount: true, fanCount: true },
  });
  const sections = parseSections(first(params.sections));
  const has = (section: (typeof sections)[number]) => sections.includes(section);
  const branding = await prisma.workspace.findUniqueOrThrow({
    where: { id: auth.workspace.id },
    select: { name: true, logoUrl: true, reportTitle: true, reportSubtitle: true, reportFooter: true, aiEnabled: true },
  });
  const selected = pages.find((page) => page.id === first(params.target)) ?? pages[0] ?? null;
  const canEdit = atLeast(auth.role, WorkspaceRole.editor);
  const [templates, schedules] = await Promise.all([
    prisma.reportTemplate.findMany({ where: { workspaceId: auth.workspace.id }, orderBy: { name: 'asc' } }),
    selected && canEdit
      ? prisma.reportSchedule.findMany({
          where: { workspaceId: auth.workspace.id, targetId: selected.id },
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve([]),
  ]);
  const sectionsKey = [...sections].sort().join(',');
  const templateRows = templates.map((template) => {
    const chosen = parseSections((template.sections as string[]).join(','));
    return {
      id: template.id,
      name: template.name,
      href: `/reports?${new URLSearchParams({
        ...(selected ? { target: selected.id } : {}),
        range: template.rangeKey,
        sections: chosen.join(','),
      }).toString()}`,
      active: [...chosen].sort().join(',') === sectionsKey && range.key === template.rangeKey,
    };
  });
  const activeTemplate = templateRows.find((row) => row.active) ?? null;

  // Goals (H12) of the month the report ends in (`to` is the instant after its last day).
  const lastInstant = new Date(to.getTime() - 1);
  const goals =
    selected && !rangeError
      ? await readGoals({ workspaceId: auth.workspace.id, targetIds: [selected.id], timeZone: timezone, at: lastInstant })
      : [];
  const tGoals = await getTranslations('goals');

  const report = rangeError
    ? null
    : await buildReport({
        workspaceId: auth.workspace.id,
        timezone,
        from,
        to,
        ...(pageScope.all ? {} : { targetIds: pageScope.ids }),
      });

  const cards = report
    ? [
        { label: t('postsPublished'), value: report.postsPublished },
        { label: t('totalReach'), value: report.totals.reach },
        { label: t('totalEngagement'), value: report.totals.engagement },
        { label: t('linkClicksLifetime'), value: report.totals.linkClicks },
      ]
    : [];

  const sectionsParam = first(params.sections);
  const keep: Record<string, string> = {
    ...(selected ? { target: selected.id } : {}),
    ...(sectionsParam ? { sections: sectionsParam } : {}),
  };
  const pageHref = (id: string) =>
    `/reports?${new URLSearchParams({
      target: id,
      ...(range.key === 'custom' ? { from: range.fromDay, to: range.toDay } : { range: range.key }),
      ...(sectionsParam ? { sections: sectionsParam } : {}),
    }).toString()}`;

  return (
    <ChannelsLayout auth={auth} selection={selection} tools={<PhoneFold><div className="flex flex-col gap-2">{selected && canEdit && (
            <ReportSchedules
              targetId={selected.id}
              pageName={selected.name}
              templateId={activeTemplate?.id ?? null}
              schedules={schedules.map((row) => ({
                id: row.id,
                frequency: row.frequency as 'weekly' | 'monthly',
                recipients: row.recipients,
                nextLabel: formatInZone(row.nextRunAt, timezone, 'EEE d MMM, HH:mm'),
                lastLabel: row.lastRunAt ? formatInZone(row.lastRunAt, timezone, 'd MMM, HH:mm') : null,
                lastError: row.lastError,
                aiRecap: row.aiRecap,
              }))}
              aiOn={aiAvailable() && branding.aiEnabled}
            />
          )}
          <ReportControls
            from={range.fromDay}
            to={range.toDay}
            downloadable={!rangeError}
            pdfName={`${selected?.name ?? branding.name} – ${range.fromDay} – ${range.toDay}`}
          />
          <ReportBuilder
            sections={sections}
            canBrand={canManageSettings(auth.role)}
            branding={{
              logoUrl: branding.logoUrl ?? '',
              reportTitle: branding.reportTitle ?? '',
              reportSubtitle: branding.reportSubtitle ?? '',
              reportFooter: branding.reportFooter ?? '',
            }}
          /></div></PhoneFold>}>
    <div className="min-w-0 flex-1 space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('subtitle')} />

      <ReportTemplates templates={templateRows} sections={sections} rangeKey={range.key} canSave={canEdit} />

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
              <section className="card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-brand-50 to-white px-5 py-4">
                  {branding.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={branding.logoUrl} alt={branding.name} className="h-10 max-w-[180px] object-contain" />
                  ) : (
                    <span className="text-[15px] font-bold text-slate-900">{branding.name}</span>
                  )}
                  <p className="text-xs text-slate-500">
                    {t('generatedOn', { date: formatInZone(new Date(), timezone, 'd MMMM yyyy, HH:mm') })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4 px-5 py-5">
                  {selected.pictureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selected.pictureUrl} alt="" className="h-16 w-16 rounded-full object-cover ring-4 ring-white" />
                  ) : (
                    <span
                      aria-hidden
                      className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-2xl font-bold text-brand-600"
                    >
                      {selected.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className="text-2xl font-bold text-slate-900">
                      {branding.reportTitle || t('coverTitle', { page: selected.name })}
                    </h2>
                    {branding.reportSubtitle && <p className="text-[15px] text-slate-700">{branding.reportSubtitle}</p>}
                    <p className="mt-0.5 text-sm text-slate-600">
                      {branding.reportTitle ? `${selected.name} · ` : ''}
                      {formatInZone(from, timezone, 'd MMMM yyyy')} – {formatInZone(to, timezone, 'd MMMM yyyy')}
                    </p>
                  </div>
                </div>
              </section>

              {has('analysis') && (
                <PageAnalysisView
                  workspaceId={auth.workspace.id}
                  targetId={selected.id}
                  from={from}
                  to={to}
                  days={range.days}
                  timeZone={timezone}
                />
              )}

              {has('goals') && goals.length > 0 && (
                <section aria-labelledby="report-goals" className="space-y-4">
                  <h2 id="report-goals" className="text-[17px] font-bold text-slate-900">
                    {tGoals('reportTitle', { month: formatInZone(lastInstant, timezone, 'MMMM yyyy') })}
                  </h2>
                  <div className="card p-5">
                    <GoalsView pages={goals} showNames={false} />
                  </div>
                </section>
              )}

              {has('responseTime') && selected && (
                <section aria-labelledby="report-response-time" className="space-y-4">
                  <h2 id="report-response-time" className="text-[17px] font-bold text-slate-900">
                    {t('section_responseTime')}
                  </h2>
                  <ResponseTimeView workspaceId={auth.workspace.id} targetIds={[selected.id]} from={from} to={to} timeZone={timezone} nested />
                </section>
              )}

              {has('audience') && (
                <section aria-labelledby="report-audience" className="space-y-4">
                  <h2 id="report-audience" className="text-[17px] font-bold text-slate-900">
                    {t('audienceTitle')}
                  </h2>
                  <AudienceView targetId={selected.id} from={from} to={to} timeZone={timezone} />
                </section>
              )}
            </>
          )}

          {(has('published') || has('destinations') || has('topPosts')) && (
          <section aria-labelledby="report-published" className="space-y-4">
            <div>
              <h2 id="report-published" className="text-[17px] font-bold text-slate-900">
                {t('publishedHere')}
              </h2>
              <p className="text-sm text-slate-600">{t('publishedHereHint')}</p>
            </div>

            {has('published') && (
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
            )}

            {!report || report.destinations.length === 0 ? (
              <EmptyState title={t('noData')} />
            ) : (
              <>
                {has('destinations') && (
                <section className="card p-5">
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">{t('byDestination')}</h3>
                  {/* Wide table: scrolls inside its own container rather than the page. */}
                  <div className="overflow-x-auto">
                    <table className="data-table w-full min-w-[42rem] text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-start text-[13px] font-semibold text-slate-600">
                          <th scope="col" className="py-2 pe-3 font-medium">{t('destination')}</th>
                          {/* Not the headline figure: that counts posts, this counts
                              the times each destination was posted to, so one post
                              to three Pages is 1 up there and 1+1+1 here. */}
                          <th scope="col" className="py-2 pe-3 text-end font-medium">{t('postsSent')}</th>
                          <th scope="col" className="py-2 pe-3 text-end font-medium">{t('impressions')}</th>
                          <th scope="col" className="py-2 pe-3 text-end font-medium">{t('totalReach')}</th>
                          <th scope="col" className="py-2 pe-3 text-end font-medium">{t('totalEngagement')}</th>
                          <th scope="col" className="py-2 text-end font-medium">{t('linkClicksLifetime')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.destinations.map((row) => (
                          <tr key={row.targetId} className="border-b border-slate-100 last:border-0">
                            <td className="py-2 pe-3 font-medium text-slate-800">{row.name}</td>
                            <td className="py-2 pe-3 text-end text-slate-600">{row.posts}</td>
                            <td className="py-2 pe-3 text-end text-slate-600">
                              {row.impressions.toLocaleString(appLocale())}
                            </td>
                            <td className="py-2 pe-3 text-end text-slate-600">
                              {row.reach.toLocaleString(appLocale())}
                            </td>
                            <td className="py-2 pe-3 text-end text-slate-600">
                              {(row.reactions + row.comments + row.shares).toLocaleString(appLocale())}
                            </td>
                            <td className="py-2 text-end text-slate-600">{row.clicks.toLocaleString(appLocale())}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                )}

                {has('topPosts') && (
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
                          media={post.media ?? []}
                          link={post.link}
                          linkPreview={post.linkPreview}
                          seeMore={tAll('common.seeMore')}
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
                )}
              </>
            )}
          </section>
          )}
        </>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-xs text-slate-500">
        <span>{branding.reportFooter || t('sourceNote')}</span>
        {branding.reportFooter && <span>{t('sourceNote')}</span>}
      </footer>
    </div>
    </ChannelsLayout>
  );
}
