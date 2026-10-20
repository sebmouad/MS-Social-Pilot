import { headers } from 'next/headers';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import { readPosts } from './service';
import styles from '@/modules/analytics/ui/reports/workflows.module.css';

export default async function PostsScreen({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer({ feature: 'analytics/posts', channelScoped: true });
  const fr = (await headers()).get('accept-language')?.startsWith('fr') ?? false;
  const t = (en: string, french: string) => fr ? french : en;
  const raw = await searchParams;
  let data: Awaited<ReturnType<typeof readPosts>> | undefined;
  try { data = await readPosts({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, raw); } catch { /* Safe localized recovery below. */ }
  if (!data) return <PageFrame module="analytics" scopedAccess><section role="alert"><h1>{t('Post analytics unavailable', 'Statistiques indisponibles')}</h1><p>{t('Check your access and filters, then try again.', 'Vérifiez votre accès et vos filtres, puis réessayez.')}</p><a href="/analytics/posts">{t('Reset filters', 'Réinitialiser les filtres')}</a></section></PageFrame>;
  const d = data;
  const query = (patch: Record<string, string> = {}) => {
    const q = new URLSearchParams({ start: d.period.start, end: d.period.end, sort: d.input.sort, direction: d.input.direction, page: String(d.input.page), filter: '1' });
    d.selectedIds.forEach(id => q.append('channel', id)); Object.entries(patch).forEach(([k, v]) => q.set(k, v)); return q.toString();
  };
  const unavailable = t('Not available', 'Non disponible');
  const measureLabel = (m: { label: string; labelFr?: string }) => fr ? m.labelFr ?? m.label : m.label;
  const sidebar = <form action="/analytics/posts" className={styles.filters}>
    <h2>{t('Post explorer', 'Explorateur de publications')}</h2>
    <label>{t('Start (UTC)', 'Début (UTC)')}<input type="date" name="start" defaultValue={d.period.start} required /></label>
    <label>{t('End (UTC)', 'Fin (UTC)')}<input type="date" name="end" defaultValue={d.period.end} required /></label>
    <input type="hidden" name="filter" value="1" />
    <fieldset><legend>{t('Channels', 'Canaux')}</legend>{d.options.map(c => <label key={c.id} className={styles.check}><input type="checkbox" name="channel" value={c.id} defaultChecked={d.selectedIds.includes(c.id)} />{c.name}</label>)}</fieldset>
    <label>{t('Sort by', 'Trier par')}<select name="sort" defaultValue={d.input.sort}><option value="publishedAt">{t('Publication date', 'Date de publication')}</option>{d.measures.map(m => <option key={m.key} value={m.key}>{measureLabel(m)}</option>)}</select></label>
    <label>{t('Order', 'Ordre')}<select name="direction" defaultValue={d.input.direction}><option value="desc">{t('Descending', 'Décroissant')}</option><option value="asc">{t('Ascending', 'Croissant')}</option></select></label>
    <Button type="submit" variant="primary">{t('Apply', 'Appliquer')}</Button>
    <a href={`/api/analytics/posts?${query({ format: 'csv' })}`}>{t('Export selection (CSV)', 'Exporter la sélection (CSV)')}</a>
    <nav aria-label={t('Pages', 'Pages')} className={styles.actions}>{d.input.page > 1 && <a href={`?${query({ page: String(d.input.page - 1) })}`}>{t('Previous', 'Précédent')}</a>}<span>{t('Page', 'Page')} {d.input.page}</span>{d.nextPage && <a href={`?${query({ page: String(d.nextPage) })}`}>{t('Next', 'Suivant')}</a>}</nav>
  </form>;
  return <PageFrame module="analytics" scopedAccess sidebar={sidebar}><div className={styles.root}><header className={styles.heading}><h1>{t('Post explorer', 'Explorateur de publications')}</h1><p>{t('Published posts with stored measures. Measures are snapshots, not period totals. Missing data is not available.', 'Publications et mesures enregistrées. Les mesures sont des instantanés, pas des totaux de période. Les données manquantes sont indisponibles.')}</p></header>
    <DataTable caption={t('Published posts', 'Publications publiées')} rows={d.items} rowKey={p => `${p.channelId}:${p.postId}`} emptyMessage={t('No published posts for this selection and period.', 'Aucune publication pour cette sélection et cette période.')} columns={[
      { key: 'post', label: t('Post', 'Publication'), render: p => p.url ? <a href={p.url} rel="noreferrer" target="_blank">{p.text || unavailable}</a> : p.text || unavailable },
      { key: 'channel', label: t('Channel', 'Canal'), render: p => p.channelName },
      { key: 'publishedAt', label: t('Published (UTC)', 'Publié (UTC)'), render: p => p.publishedAt?.toISOString() ?? unavailable },
      { key: 'measuredAt', label: t('Measured (UTC)', 'Mesuré (UTC)'), render: p => p.measuredAt?.toISOString() ?? unavailable },
      ...d.measures.map(m => ({ key: m.key, label: measureLabel(m), render: (p: typeof d.items[number]) => { const value = p.measures.find(v => v.key === m.key)?.value; return value == null ? unavailable : new Intl.NumberFormat(fr ? 'fr' : 'en').format(value); } })),
    ]} />
  </div></PageFrame>;
}
