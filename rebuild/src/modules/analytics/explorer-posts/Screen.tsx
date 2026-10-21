import { analyticsCopy } from '../server/copy';
import { headers } from 'next/headers';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import { readPosts } from './service';
import styles from '@/modules/analytics/ui/reports/workflows.module.css';
import local from './screen.module.css';

export default async function PostsScreen({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer({ feature: 'analytics/posts', channelScoped: true });
  const fr = (await headers()).get('accept-language')?.startsWith('fr') ?? false;
  const { records: copy } = await analyticsCopy();
  const t = (key: keyof typeof copy) => copy[key][fr ? 'fr' : 'en'];
  const raw = await searchParams;
  let data: Awaited<ReturnType<typeof readPosts>> | undefined;
  try { data = await readPosts({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, raw); } catch { /* Safe localized recovery below. */ }
  if (!data) return <PageFrame module="analytics" scopedAccess><section role="alert"><h1>{t("Post analytics unavailable")}</h1><p>{t("Check your access and filters, then try again.")}</p><a href="/analytics/posts">{t("Reset filters")}</a></section></PageFrame>;
  const d = data;
  const query = (patch: Record<string, string> = {}) => {
    const q = new URLSearchParams({ start: d.period.start, end: d.period.end, sort: d.input.sort, direction: d.input.direction, page: String(d.input.page), filter: '1' });
    d.selectedIds.forEach(id => q.append('channel', id)); Object.entries(patch).forEach(([k, v]) => q.set(k, v)); return q.toString();
  };
  const unavailable = t("Not available");
  const measureLabel = (m: { label: string; labelFr?: string }) => fr ? m.labelFr ?? m.label : m.label;
  const sidebar = <form action="/analytics/posts" className={styles.filters}>
    <h2>{t("Post explorer")}</h2>
    <label>{t("Start (UTC)")}<input type="date" name="start" defaultValue={d.period.start} required /></label>
    <label>{t("End (UTC)")}<input type="date" name="end" defaultValue={d.period.end} required /></label>
    <input type="hidden" name="filter" value="1" />
    <fieldset><legend>{t("Channels")}</legend>{d.options.map(c => <label key={c.id} className={styles.check}><input type="checkbox" name="channel" value={c.id} defaultChecked={d.selectedIds.includes(c.id)} />{c.name}</label>)}</fieldset>
    <label>{t("Sort by")}<select name="sort" defaultValue={d.input.sort}><option value="publishedAt">{t("Publication date")}</option>{d.measures.map(m => <option key={m.key} value={m.key}>{measureLabel(m)}</option>)}</select></label>
    <label>{t("Order")}<select name="direction" defaultValue={d.input.direction}><option value="desc">{t("Descending")}</option><option value="asc">{t("Ascending")}</option></select></label>
    <Button type="submit" variant="primary">{t("Apply")}</Button>
    <a href={`/api/analytics/posts?${query({ format: 'csv' })}`}>{t("Export selection (CSV)")}</a>
    <nav aria-label={t("Pages")} className={styles.actions}>{d.input.page > 1 && <a href={`?${query({ page: String(d.input.page - 1) })}`}>{t("Previous")}</a>}<span>{t("Page")} {d.input.page}</span>{d.nextPage && <a href={`?${query({ page: String(d.nextPage) })}`}>{t("Next")}</a>}</nav>
  </form>;
  return <PageFrame module="analytics" scopedAccess sidebar={sidebar}><div className={`${styles.root} ${local.content}`}><header className={styles.heading}><h1>{t("Post explorer")}</h1><p>{t("Published posts with stored measures. Measures are snapshots, not period totals. Missing data is not available.")}</p></header>
    <DataTable caption={t("Published posts")} rows={d.items} rowKey={p => `${p.channelId}:${p.postId}`} emptyMessage={t("No published posts for this selection and period.")} columns={[
      { key: 'post', label: t("Post"), render: p => p.url ? <a href={p.url} rel="noreferrer" target="_blank">{p.text || unavailable}</a> : p.text || unavailable },
      { key: 'channel', label: t("Channel"), render: p => p.channelName },
      { key: 'publishedAt', label: t("Published (UTC)"), render: p => p.publishedAt?.toISOString() ?? unavailable },
      { key: 'measuredAt', label: t("Measured (UTC)"), render: p => p.measuredAt?.toISOString() ?? unavailable },
      ...d.measures.map(m => ({ key: m.key, label: measureLabel(m), render: (p: typeof d.items[number]) => { const value = p.measures.find(v => v.key === m.key)?.value; return value == null ? unavailable : new Intl.NumberFormat(fr ? 'fr' : 'en').format(value); } })),
    ]} />
  </div></PageFrame>;
}
