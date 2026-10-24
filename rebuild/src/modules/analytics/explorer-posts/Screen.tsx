import { analyticsCopy } from '../server/copy';
import { headers } from 'next/headers';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { InfoTip } from '@/components';
import { PageHeader } from '@/components/PageHeader';
import { IconDownload } from '@tabler/icons-react';
import { PostsTable } from '@/modules/analytics/ui/posts/PostsTable';
import { postsTableMeasures, postsTableRows } from '@/modules/analytics/ui/posts/rows';
import { pageChannelScope } from '@/modules/shell/server/scope';
import { insightsReadInput } from '@/modules/analytics/ui/insights/scope';
import { AddressSelect } from '@/modules/analytics/ui/insights/AddressSelect';
import { InsightsFilterRow } from '@/modules/analytics/ui/insights/InsightsFilterRow';
import { insightsCopyDefaults, insightsPolicyDefaults, resolveInsightsCopy } from '@/modules/analytics/ui/insights/insights-config';
import { presetRange, resolvePeriod } from '@/modules/analytics/ui/insights/period';
import { workspaceInstantFormatter } from '@/server/instant-labels';
import { readPosts, resolveInternalPostIds } from './service';
import styles from '@/modules/analytics/ui/reports/workflows.module.css';
import local from './screen.module.css';

const first = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] ?? '' : v ?? '';

export default async function PostsScreen({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer({ feature: 'analytics/posts', channelScoped: true });
  const fr = (await headers()).get('accept-language')?.startsWith('fr') ?? false;
  const locale = fr ? 'fr' : 'en';
  const { records: copy } = await analyticsCopy();
  const t = (key: keyof typeof copy) => copy[key][locale];
  const raw = await searchParams;
  let data: Awaited<ReturnType<typeof readPosts>> | undefined;
  // The sidebar's channel list scopes the page; the page keeps its dates and sort.
  const scope = await pageChannelScope(viewer, raw);
  const presetPeriod = first(raw.period) ? resolvePeriod(raw, insightsPolicyDefaults) : null;
  const readInput = insightsReadInput(raw, scope.ids, presetPeriod ? { start: presetPeriod.start, end: presetPeriod.end } : {});
  delete readInput.period;
  try { data = await readPosts({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, readInput); } catch { /* Safe localized recovery below. */ }
  if (!data) return <PageFrame module="analytics" scopedAccess><section role="alert"><h1>{t("Post analytics unavailable")}</h1><p>{t("Check your access and filters, then try again.")}</p><a href="/insights/posts">{t("Reset filters")}</a></section></PageFrame>;
  const d = data;
  // Page links carry the sidebar scope (`channel=a,b`); the download API takes the services' explicit channel filter.
  const query = (patch: Record<string, string> = {}, api = false) => {
    const q = new URLSearchParams({ start: d.period.start, end: d.period.end, sort: d.input.sort, direction: d.input.direction, page: String(d.input.page) });
    if (api) { q.set('filter', '1'); d.selectedIds.forEach(id => q.append('channel', id)); } else if (scope.ids.length) q.set('channel', scope.ids.join(','));
    Object.entries(patch).forEach(([k, v]) => q.set(k, v)); return q.toString();
  };
  const measureLabel = (m: { label: string; labelFr?: string }) => fr ? m.labelFr ?? m.label : m.label;
  const now = new Date();
  const presets = insightsPolicyDefaults.rangePresets.map(item => ({ id: item.id, label: item.label[locale], ...presetRange(item, now) }));
  const matchedPreset = presets.find(item => item.id === first(raw.period)) ?? presets.find(item => item.start === d.period.start && item.end === d.period.end);
  const periodValue = { preset: matchedPreset?.id ?? 'custom', start: d.period.start, end: d.period.end };
  const ui = resolveInsightsCopy(insightsCopyDefaults as never, locale);
  const sortOptions = [
    { value: 'publishedAt', label: t("Publication date") },
    ...d.populatedMeasures.concat(d.measures.filter(m => m.key === d.input.sort && !d.populatedMeasures.some(p => p.key === m.key))).map(m => ({ value: m.key, label: measureLabel(m) })),
  ];
  const directionOptions = [
    { value: 'desc', label: t("Descending") },
    { value: 'asc', label: t("Ascending") },
  ];
  // One toolbar on the title row (period picker, sort, order); export beside it and paging under the table.
  const toolbar = <div className={styles.toolbar} role="group" aria-label={t("Post explorer")}>
    <InsightsFilterRow presets={presets} period={periodValue} compare={false} showCompare={false} writePresetDates
      labels={{ period: ui.datePeriod, compare: ui.compareToggle, active: ui.activeFilters, remove: ui.removeFilter, reset: ui.resetFilters, filters: t("Post explorer"), customSummary: ui.datePeriod }} />
    <AddressSelect className={styles.inlineField} name="sort" label={t("Sort by")} defaultValue={d.input.sort} options={sortOptions} />
    <AddressSelect className={styles.inlineField} name="direction" label={t("Order")} hideLabel defaultValue={d.input.direction} options={directionOptions} />
    <a className="ui-button ui-button--quiet ui-button--sm" href={`/api/analytics/posts?${query({ format: 'csv' }, true)}`}><IconDownload size={16} aria-hidden="true" />{t("Export selection (CSV)")}</a>
  </div>;
  return <PageFrame module="analytics" scopedAccess><div className={`${styles.root} ${local.content}`}>
    <PageHeader module="analytics" title={t("Post explorer")} info={<InfoTip name={t("Post explorer")} blocks={[{ text: t("Published posts with stored measures. Measures are snapshots, not period totals. Missing data is not available.") }]} />} filters={toolbar} />
    <PostsTable copy={copy} rows={postsTableRows(d.items, await workspaceInstantFormatter(viewer.workspaceId, locale), await resolveInternalPostIds(viewer.workspaceId, d.items))} measures={postsTableMeasures(d.measures, locale)} locale={locale} />
    {d.input.page > 1 || d.nextPage ? <nav aria-label={t("Pages")} className={styles.pager}>{d.input.page > 1 && <a href={`?${query({ page: String(d.input.page - 1) })}`}>{t("Previous")}</a>}<span>{t("Page")} {d.input.page}</span>{d.nextPage && <a href={`?${query({ page: String(d.nextPage) })}`}>{t("Next")}</a>}</nav> : null}
  </div></PageFrame>;
}
