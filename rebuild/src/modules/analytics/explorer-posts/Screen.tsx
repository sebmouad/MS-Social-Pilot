import { analyticsCopy } from '../server/copy';
import { headers } from 'next/headers';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { Button } from '@/components/Button';
import { InfoTip } from '@/components';
import { PageHeader } from '@/components/PageHeader';
import { IconDownload } from '@tabler/icons-react';
import { PostsTable } from '@/modules/analytics/ui/posts/PostsTable';
import { postsTableMeasures, postsTableRows } from '@/modules/analytics/ui/posts/rows';
import { pageChannelScope } from '@/modules/shell/server/scope';
import { insightsReadInput } from '@/modules/analytics/ui/insights/scope';
import { workspaceInstantFormatter } from '@/server/instant-labels';
import { readPosts, resolveInternalPostIds } from './service';
import styles from '@/modules/analytics/ui/reports/workflows.module.css';
import local from './screen.module.css';

export default async function PostsScreen({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer({ feature: 'analytics/posts', channelScoped: true });
  const fr = (await headers()).get('accept-language')?.startsWith('fr') ?? false;
  const { records: copy } = await analyticsCopy();
  const t = (key: keyof typeof copy) => copy[key][fr ? 'fr' : 'en'];
  const raw = await searchParams;
  let data: Awaited<ReturnType<typeof readPosts>> | undefined;
  // The sidebar's channel list scopes the page; the page keeps its dates and sort.
  const scope = await pageChannelScope(viewer, raw);
  try { data = await readPosts({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, insightsReadInput(raw, scope.ids)); } catch { /* Safe localized recovery below. */ }
  if (!data) return <PageFrame module="analytics" scopedAccess><section role="alert"><h1>{t("Post analytics unavailable")}</h1><p>{t("Check your access and filters, then try again.")}</p><a href="/insights/posts">{t("Reset filters")}</a></section></PageFrame>;
  const d = data;
  // Page links carry the sidebar scope (`channel=a,b`); the download API takes the services' explicit channel filter.
  const query = (patch: Record<string, string> = {}, api = false) => {
    const q = new URLSearchParams({ start: d.period.start, end: d.period.end, sort: d.input.sort, direction: d.input.direction, page: String(d.input.page) });
    if (api) { q.set('filter', '1'); d.selectedIds.forEach(id => q.append('channel', id)); } else if (scope.ids.length) q.set('channel', scope.ids.join(','));
    Object.entries(patch).forEach(([k, v]) => q.set(k, v)); return q.toString();
  };
  const measureLabel = (m: { label: string; labelFr?: string }) => fr ? m.labelFr ?? m.label : m.label;
  // One toolbar on the title row (period, sort, Apply); export beside it and paging under the table.
  const toolbar = <form action="/insights/posts" className={styles.toolbar} aria-label={t("Post explorer")}>
    <label className={styles.inlineField}><span>{t("Start (UTC)")}</span><input type="date" name="start" defaultValue={d.period.start} required /></label>
    <label className={styles.inlineField}><span>{t("End (UTC)")}</span><input type="date" name="end" defaultValue={d.period.end} required /></label>
    {scope.ids.length ? <input type="hidden" name="channel" value={scope.ids.join(',')} /> : null}
    <label className={styles.inlineField}><span>{t("Sort by")}</span><select name="sort" defaultValue={d.input.sort}><option value="publishedAt">{t("Publication date")}</option>{d.populatedMeasures.concat(d.measures.filter(m => m.key === d.input.sort && !d.populatedMeasures.some(p => p.key === m.key))).map(m => <option key={m.key} value={m.key}>{measureLabel(m)}</option>)}</select></label>
    <label className={styles.inlineField}><span className="ui-visually-hidden">{t("Order")}</span><select name="direction" defaultValue={d.input.direction}><option value="desc">{t("Descending")}</option><option value="asc">{t("Ascending")}</option></select></label>
    <Button type="submit" variant="secondary" size="sm">{t("Apply")}</Button>
    <a className="ui-button ui-button--quiet ui-button--sm" href={`/api/analytics/posts?${query({ format: 'csv' }, true)}`}><IconDownload size={16} aria-hidden="true" />{t("Export selection (CSV)")}</a>
  </form>;
  return <PageFrame module="analytics" scopedAccess><div className={`${styles.root} ${local.content}`}>
    <PageHeader module="analytics" title={t("Post explorer")} info={<InfoTip name={t("Post explorer")} blocks={[{ text: t("Published posts with stored measures. Measures are snapshots, not period totals. Missing data is not available.") }]} />} filters={toolbar} />
    <PostsTable copy={copy} rows={postsTableRows(d.items, await workspaceInstantFormatter(viewer.workspaceId, fr ? 'fr' : 'en'), await resolveInternalPostIds(viewer.workspaceId, d.items))} measures={postsTableMeasures(d.measures, fr ? 'fr' : 'en')} locale={fr ? 'fr' : 'en'} />
    {d.input.page > 1 || d.nextPage ? <nav aria-label={t("Pages")} className={styles.pager}>{d.input.page > 1 && <a href={`?${query({ page: String(d.input.page - 1) })}`}>{t("Previous")}</a>}<span>{t("Page")} {d.input.page}</span>{d.nextPage && <a href={`?${query({ page: String(d.nextPage) })}`}>{t("Next")}</a>}</nav> : null}
  </div></PageFrame>;
}
