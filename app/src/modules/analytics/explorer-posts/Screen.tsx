import { analyticsCopy } from '../server/copy';
import { headers } from 'next/headers';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { InfoTip, LinkTabs } from '@/components';
import { PageHeader } from '@/components/PageHeader';
import { SyncNowButton } from '@/modules/analytics/ui/SyncNowButton';
import { IconDownload } from '@tabler/icons-react';
import { PostsTable } from '@/modules/analytics/ui/posts/PostsTable';
import { postsTableMeasures, postsTableRows } from '@/modules/analytics/ui/posts/rows';
import { pageChannelScope } from '@/modules/shell/server/scope';
import { insightsReadInput } from '@/modules/analytics/ui/insights/scope';
import { InsightsFilterRow } from '@/modules/analytics/ui/insights/InsightsFilterRow';
import { insightsCopyDefaults, insightsPolicyDefaults, resolveInsightsCopy } from '@/modules/analytics/ui/insights/insights-config';
import { presetRange, resolvePeriod } from '@/modules/analytics/ui/insights/period';
import { workspaceInstantFormatter } from '@/server/instant-labels';
import { readPosts, resolveInternalPostIds } from './service';
import { digest, postFacts, totalsOf } from './performance';
import { PerformancePanel } from './PerformancePanel';
import { shellChrome } from '@/modules/shell/server/chrome';
import { prisma } from '@/server/data';
import styles from '@/modules/analytics/ui/reports/workflows.module.css';
import local from './screen.module.css';

const first = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] ?? '' : v ?? '';
/** The page's tabs (owner directive 2026-11-08): the posts table, then "what works" in three parts. */
const VIEWS = ['posts', 'summary', 'timing', 'content'] as const;

export default async function PostsScreen({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer({ feature: 'analytics/posts', channelScoped: true });
  const fr = (await headers()).get('accept-language')?.startsWith('fr') ?? false;
  const locale = fr ? 'fr' : 'en';
  const { records: copy } = await analyticsCopy();
  const t = (key: keyof typeof copy) => copy[key][locale];
  const raw = await searchParams;
  const view = VIEWS.find(id => id === first(raw.view)) ?? 'posts';
  let data: Awaited<ReturnType<typeof readPosts>> | undefined;
  // The sidebar's channel list scopes the page; the page keeps its dates and sort.
  const scope = await pageChannelScope(viewer, raw);
  const presetPeriod = first(raw.period) ? resolvePeriod(raw, insightsPolicyDefaults) : null;
  const readInput = insightsReadInput(raw, scope.ids, presetPeriod ? { start: presetPeriod.start, end: presetPeriod.end } : {});
  delete readInput.period;
  delete readInput.view;
  try { data = await readPosts({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, readInput); } catch { /* Safe localized recovery below. */ }
  if (!data) return <PageFrame module="analytics" scopedAccess><section role="alert"><h1>{t("Post analytics unavailable")}</h1><p>{t("Check your access and filters, then try again.")}</p><a href="/insights/posts">{t("Reset filters")}</a></section></PageFrame>;
  const d = data;
  // "What works" over the same period and channels, against the previous period of the same length.
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const channelFilter = scope.ids.length ? { filter: '1' as const, channel: scope.ids } : {};
  const dayMs = 86_400_000;
  const startAt = Date.parse(`${d.period.start}T00:00:00Z`), endAt = Date.parse(`${d.period.end}T00:00:00Z`);
  const span = Math.max(1, Math.round((endAt - startAt) / dayMs) + 1);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  // Only the "what works" tabs read the period's facts.
  const [current, previous, workspace, { copy: shell }] = await Promise.all([
    view === 'posts' ? null : postFacts(actor, { start: d.period.start, end: d.period.end, ...channelFilter }).catch(() => null),
    view === 'posts' ? null : postFacts(actor, { start: iso(startAt - span * dayMs), end: iso(startAt - dayMs), ...channelFilter }).catch(() => null),
    view === 'posts' ? null : prisma.workspace.findUnique({ where: { id: viewer.workspaceId }, select: { timezone: true } }),
    shellChrome(),
  ]);
  // Page links carry the sidebar scope (`channel=a,b`); the download API takes the services' explicit channel filter.
  const query = (patch: Record<string, string> = {}, api = false) => {
    const q = new URLSearchParams({ start: d.period.start, end: d.period.end, sort: d.input.sort, direction: d.input.direction, page: String(d.input.page) });
    if (api) { q.set('filter', '1'); d.selectedIds.forEach(id => q.append('channel', id)); } else if (scope.ids.length) q.set('channel', scope.ids.join(','));
    Object.entries(patch).forEach(([k, v]) => q.set(k, v)); return q.toString();
  };
  const now = new Date();
  const presets = insightsPolicyDefaults.rangePresets.map(item => ({ id: item.id, label: item.label[locale], ...presetRange(item, now) }));
  const matchedPreset = presets.find(item => item.id === first(raw.period)) ?? presets.find(item => item.start === d.period.start && item.end === d.period.end);
  const periodValue = { preset: matchedPreset?.id ?? 'custom', start: d.period.start, end: d.period.end };
  // Each tab keeps the period and the channels; sort and paging belong to the Posts tab.
  const viewHref = (target: (typeof VIEWS)[number]) => {
    const q = new URLSearchParams({ start: d.period.start, end: d.period.end });
    if (first(raw.period)) q.set('period', first(raw.period));
    if (scope.ids.length) q.set('channel', scope.ids.join(','));
    if (target !== 'posts') q.set('view', target);
    return `/insights/posts?${q.toString()}`;
  };
  const viewLabel = { posts: t("Posts"), summary: t("Summary"), timing: t("Timing"), content: t("Content") };
  const viewTabs = <LinkTabs label={t("Post explorer views")} moreLabel={shell.moreTabs} activeId={view} items={VIEWS.map(id => ({ id, href: viewHref(id), label: viewLabel[id] }))} />;
  const ui = resolveInsightsCopy(insightsCopyDefaults as never, locale);
  // One toolbar on the title row (period picker, export); sorting is done from the column headers (2026-11-12).
  const toolbar = <div className={styles.toolbar} role="group" aria-label={t("Post explorer")}>
    <InsightsFilterRow presets={presets} period={periodValue} compare={false} showCompare={false} writePresetDates
      labels={{ period: ui.datePeriod, compare: ui.compareToggle, active: ui.activeFilters, remove: ui.removeFilter, reset: ui.resetFilters, filters: t("Post explorer"), customSummary: ui.datePeriod }} />
    {view === 'posts' ? <>
      <a className="ui-button ui-button--quiet ui-button--sm" href={`/api/analytics/posts?${query({ format: 'csv' }, true)}`}><IconDownload size={16} aria-hidden="true" />{t("Export selection (CSV)")}</a>
    </> : null}
  </div>;
  return <PageFrame module="analytics" scopedAccess><div className={`${styles.root} ${local.content}`}>
    <PageHeader module="analytics" title={t("Post explorer")} info={<InfoTip name={t("Post explorer")} blocks={[{ text: t("Published posts with stored measures. Measures are snapshots, not period totals. Missing data is not available.") }]} />} actions={<SyncNowButton locale={locale} />} filters={toolbar} tabs={viewTabs} />
    {view !== 'posts' && current && <PerformancePanel section={view} digest={digest(current.facts, workspace?.timezone || 'UTC')} before={previous ? totalsOf(previous.facts) : null} complete={current.complete} locale={locale} />}
    {view !== 'posts' && !current && <p role="alert">{t("Check your access and filters, then try again.")}</p>}
    {view === 'posts' ? <><PostsTable copy={copy} rows={postsTableRows(d.items, await workspaceInstantFormatter(viewer.workspaceId, locale), await resolveInternalPostIds(viewer.workspaceId, d.items))} measures={postsTableMeasures(d.measures, locale)} locale={locale} sortKey={d.input.sort} sortDirection={d.input.direction} />
    {d.input.page > 1 || d.nextPage ? <nav aria-label={t("Pages")} className={styles.pager}>{d.input.page > 1 && <a href={`?${query({ page: String(d.input.page - 1) })}`}>{t("Previous")}</a>}<span>{t("Page")} {d.input.page}</span>{d.nextPage && <a href={`?${query({ page: String(d.nextPage) })}`}>{t("Next")}</a>}</nav> : null}</> : null}
  </div></PageFrame>;
}
