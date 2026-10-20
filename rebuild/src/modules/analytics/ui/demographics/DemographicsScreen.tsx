import { headers } from 'next/headers';
import { Button } from '@/components/Button';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { readDemographics } from '@/modules/analytics/demographics/server/demographics';
import { readAnalyticsSnapshot } from '@/modules/analytics/server/read';
import { WorkflowNav } from '@/modules/analytics/ui/reports/WorkflowNav';
import styles from '@/modules/analytics/ui/reports/workflows.module.css';

type Search = Record<string, string | string[] | undefined>;
const first = (v: Search[string]) => Array.isArray(v) ? v[0] ?? '' : v ?? '';
const values = (v: Search[string]) => v === undefined ? [] : Array.isArray(v) ? v : [v];

export default async function DemographicsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await requireViewer({ feature: 'analytics/demographics', channelScoped: true });
  const fr = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '');
  const t = (en: string, french: string) => fr ? french : en;
  const number = new Intl.NumberFormat(fr ? 'fr' : 'en', { maximumFractionDigits: 1 });
  const unknown = t('Not available', 'Non disponible');
  const when = (date: Date | null) => date ? date.toISOString().replace('T', ' ').replace('.000Z', ' UTC') : unknown;
  const params = await searchParams;
  let data: Awaited<ReturnType<typeof readDemographics>> | null = null;
  let options: Awaited<ReturnType<typeof readAnalyticsSnapshot>> | null = null;
  let failed = false;
  try { data = await readDemographics({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, params); }
  catch { failed = true; }
  if (!data) {
    try { options = await readAnalyticsSnapshot({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, {}, { feature: 'analytics/demographics' }); }
    catch { /* Preserve the correction form. */ }
  }
  const channels = data?.options.channels ?? options?.options.channels ?? [];
  const explicit = params.filter === '1' || params.channel !== undefined;
  const selected = new Set(explicit ? values(params.channel) : data?.selected.channelIds ?? channels.map(c => c.id));
  const unavailable = values(params.channel).filter(id => !channels.some(c => c.id === id));
  const query = new URLSearchParams();
  if (data) {
    query.set('start', data.period.start); query.set('end', data.period.end); query.set('filter', '1');
    data.selected.channelIds.forEach(id => query.append('channel', id)); query.set('format', 'csv');
  }
  const dateField = (name: 'start' | 'end', label: string) => {
    const value = params[name] !== undefined ? first(params[name]) : data?.period[name] ?? options?.period[name] ?? '';
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    return <label className="ui-field">{label}<input className="ui-input" type={!value || valid ? 'date' : 'text'} name={name} defaultValue={value} aria-describedby={failed ? 'demographics-error' : undefined} /></label>;
  };
  const filters = <form noValidate action="/analytics/demographics" className={styles.filters}>
    <fieldset><legend>{t('Date range (UTC)', 'Période (UTC)')}</legend>{dateField('start', t('From', 'Du'))}{dateField('end', t('To', 'Au'))}</fieldset>
    <fieldset><legend>{t('Channels', 'Canaux')}</legend><input type="hidden" name="filter" value="1" />
      {channels.map(channel => <label className={styles.check} key={channel.id}><input type="checkbox" name="channel" value={channel.id} defaultChecked={selected.has(channel.id)} />{channel.name}</label>)}
      {!channels.length && <p>{t('No channels available.', 'Aucun canal disponible.')}</p>}
      {unavailable.map(id => <label className={styles.check} key={id}><input type="checkbox" name="channel" value={id} defaultChecked />{t('Unavailable channel selection', 'Sélection de canal indisponible')}</label>)}
    </fieldset><Button type="submit" variant="primary">{t('Apply filters', 'Appliquer les filtres')}</Button>
    <a href="/analytics/demographics">{t('Reset filters', 'Réinitialiser les filtres')}</a>
    {data && <a href={`/api/analytics/demographics?${query}`} download>{t('Export full history (CSV)', 'Exporter tout l’historique (CSV)')}</a>}
  </form>;
  const metrics = data ? [...data.groups.flatMap(group => group.metrics), ...data.other] : [];
  return <PageFrame module="analytics" scopedAccess sidebar={<WorkflowNav current="/analytics/demographics">{filters}</WorkflowNav>}><div className={styles.root}>
    <header className={styles.heading}><p className={styles.eyebrow}>{t('Analytics', 'Statistiques')}</p><h1>{t('Audience history', 'Historique de l’audience')}</h1>
      <p>{t('Stored age, gender, country, city and language categories, as supplied by the provider. Each snapshot stands alone; counts are never added across dates or sources.', 'Catégories d’âge, de genre, de pays, de ville et de langue enregistrées telles que fournies. Chaque mesure reste distincte ; les nombres ne sont jamais additionnés entre dates ou sources.')}</p>
      {data && <p>{data.period.start} — {data.period.end} UTC</p>}</header>
    {failed && <section id="demographics-error" role="alert" className={styles.panel}><h2>{t('History could not be loaded', 'Impossible de charger l’historique')}</h2><p>{t('Review your dates and channels, narrow the period, or retry. Your filters have been retained.', 'Vérifiez les dates et les canaux, réduisez la période ou réessayez. Vos filtres sont conservés.')}</p></section>}
    {data && <section className={styles.panel}><h2>{t('Audience size', 'Taille de l’audience')}</h2><p>{data.audience.covered ? number.format(data.audience.total) : unknown} · {data.audience.covered} / {data.audience.selected} {t('selected channels', 'canaux sélectionnés')}</p><p>{t('Latest valid figure per covered channel. This is not a count of unique people across networks.', 'Dernière valeur valide de chaque canal couvert. Ce total ne représente pas des personnes uniques entre réseaux.')}</p></section>}
    {data?.empty && <section className={styles.panel}><h2>{t('No stored breakdowns', 'Aucune répartition enregistrée')}</h2><p>{t('Not available for these channels and dates. Try another period or channel.', 'Non disponible pour ces canaux et ces dates. Essayez une autre période ou un autre canal.')}</p></section>}
    {metrics.map(metric => <section key={metric.key} className={styles.panel}><h2>{metric.label}</h2><p>{metric.sourceLabel} · {metric.unit}</p>
      <p>{t('Channels with stored snapshots', 'Canaux avec des mesures enregistrées')} : {metric.historyCoverage.covered} / {metric.historyCoverage.selected} · {when(metric.historyCoverage.oldestAsOf)} — {when(metric.historyCoverage.newestAsOf)}</p>
      {!metric.history.length && <p>{unknown}</p>}
      {metric.history.map(item => <details key={`${item.resourceId}:${item.asOf.toISOString()}`}><summary>{item.resourceLabel} · {t('As of', 'Au')} {when(item.asOf)}</summary>
        <p>{t('Fetched at', 'Collecté le')} {when(item.fetchedAt)}</p>
        <div className={styles.tableWrap}><table><caption>{metric.label} · {item.resourceLabel} · {when(item.asOf)}</caption><thead><tr><th scope="col">{t('Category', 'Catégorie')}</th><th scope="col">{t('Value', 'Valeur')}</th><th scope="col">{t('Share of snapshot', 'Part de la mesure')}</th></tr></thead><tbody>
          {item.rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.value === null ? unknown : number.format(row.value)}</td><td>{row.share === null ? unknown : `${number.format(row.share)}%`}</td></tr>)}
        </tbody></table></div></details>)}
    </section>)}
  </div></PageFrame>;
}
