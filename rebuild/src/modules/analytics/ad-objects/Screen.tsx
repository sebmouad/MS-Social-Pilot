import { headers } from 'next/headers';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import { readAdObjects } from './service';
import type { AdObject } from './aggregate';
import styles from '@/modules/analytics/ui/reports/workflows.module.css';
import local from './screen.module.css';

type Params = Record<string, string | string[] | undefined>;
export default async function AdObjectsScreen({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireViewer({ feature: 'analytics/ads', channelScoped: true });
  const fr = (await headers()).get('accept-language')?.startsWith('fr') ?? false;
  const t = (en: string, french: string) => fr ? french : en;
  const missing = t('Not available', 'Non disponible');
  const raw = await searchParams;
  let data: Awaited<ReturnType<typeof readAdObjects>> | undefined;
  try { data = await readAdObjects({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, raw); } catch { /* Localized recovery retains submitted values. */ }
  const value = (key: string) => { const v = raw[key]; return typeof v === 'string' ? v : ''; };
  const current = data?.input;
  const query = (patch: Record<string, string | null> = {}) => {
    const q = new URLSearchParams();
    q.set('start', data?.period.start ?? value('start')); q.set('end', data?.period.end ?? value('end'));
    q.set('level', current?.level ?? (value('level') || 'campaign'));
    for (const key of ['accountId', 'parentId', 'objectId'] as const) { const v = current?.[key] ?? value(key); if (v) q.set(key, v); }
    for (const [key, v] of Object.entries(patch)) { if (v === null) q.delete(key); else q.set(key, v); }
    return q.toString();
  };
  const number = (n: number | null | undefined) => n == null ? missing : new Intl.NumberFormat(fr ? 'fr' : 'en', { maximumFractionDigits: 2 }).format(n);
  const money = (n: number | null | undefined, currency: string | null) => `${number(n)} · ${currency || missing}`;
  const level = current?.level ?? (value('level') || 'campaign');
  const levelLabel = level === 'campaign' ? t('Campaigns', 'Campagnes') : level === 'adset' ? t('Ad sets', 'Ensembles de publicités') : t('Ads', 'Publicités');
  const selectedAccount = current?.accountId ?? value('accountId');
  const options = data?.options ?? [];
  const sidebar = <form action="/analytics/ads" className={local.filters}>
    <h2>{t('Ad-object analysis', 'Analyse des objets publicitaires')}</h2>
    <label className="ui-field">{t('Start (UTC, inclusive)', 'Début (UTC, inclus)')}<input className="ui-input" type="text" name="start" placeholder="YYYY-MM-DD" defaultValue={data?.period.start ?? value('start')} /></label>
    <label className="ui-field">{t('End (UTC, inclusive)', 'Fin (UTC, incluse)')}<input className="ui-input" type="text" name="end" placeholder="YYYY-MM-DD" defaultValue={data?.period.end ?? value('end')} /></label>
    <label className="ui-field">{t('Ad account', 'Compte publicitaire')}<select className="ui-input" name="accountId" defaultValue={selectedAccount}>
      <option value="">{t('All accessible accounts', 'Tous les comptes accessibles')}</option>
      {selectedAccount && !options.some(a => a.id === selectedAccount) && <option value={selectedAccount}>{selectedAccount} · {missing}</option>}
      {options.map(a => <option key={a.id} value={a.id}>{a.name} · {a.currency || missing}</option>)}
    </select></label>
    <label className="ui-field">{t('Level', 'Niveau')}<select className="ui-input" name="level" defaultValue={level}><option value="campaign">{t('Campaigns', 'Campagnes')}</option><option value="adset">{t('Ad sets', 'Ensembles de publicités')}</option><option value="ad">{t('Ads', 'Publicités')}</option></select></label>
    <label className="ui-field">{t('Parent ID (optional; select one account)', 'ID parent (facultatif ; choisissez un compte)')}<input className="ui-input" name="parentId" defaultValue={current?.parentId ?? value('parentId')} /></label>
    <label className="ui-field">{t('Object ID (optional; select one account)', 'ID objet (facultatif ; choisissez un compte)')}<input className="ui-input" name="objectId" defaultValue={current?.objectId ?? value('objectId')} /></label>
    <Button type="submit" variant="primary">{t('Apply', 'Appliquer')}</Button>
    <a href="/analytics/ads">{t('Reset filters', 'Réinitialiser les filtres')}</a>
    {data && <><a href={`/api/analytics/ad-objects?${query({ format: 'csv', locale: fr ? 'fr' : 'en' })}`}>{t('Export selection (CSV)', 'Exporter la sélection (CSV)')}</a>
      <nav aria-label={t('Drill-down', 'Exploration')}><a href={`?${query({ level: 'campaign', parentId: null, objectId: null })}`}>{t('Back to campaigns', 'Retour aux campagnes')}</a></nav>
      <nav aria-label={t('Pages', 'Pages')} className={styles.actions}>{data.page > 1 && <a href={`?${query({ page: String(data.page - 1) })}`}>{t('Previous', 'Précédent')}</a>}<span>{t('Page', 'Page')} {data.page}</span>{data.nextPage && <a href={`?${query({ page: String(data.nextPage) })}`}>{t('Next', 'Suivant')}</a>}</nav></>}
  </form>;
  if (!data) return <PageFrame module="analytics" scopedAccess sidebar={sidebar}><section role="alert"><h1>{t('Ad-object analysis unavailable', 'Analyse publicitaire indisponible')}</h1><p>{t('Check your access and filters, or choose a shorter period, then try again.', 'Vérifiez votre accès et vos filtres, ou choisissez une période plus courte, puis réessayez.')}</p></section></PageFrame>;
  const d = data;
  const details = (item: AdObject) => <details><summary>{t('Stored daily details', 'Détails quotidiens enregistrés')} · {item.name}</summary>
    <DataTable caption={`${t('Daily measures', 'Mesures quotidiennes')} · ${item.name}`} rows={item.daily} rowKey={row => row.id} columns={[
      { key: 'day', label: t('Day UTC', 'Jour UTC'), render: r => r.date },
      { key: 'fetch', label: t('Fetched UTC', 'Collecté UTC'), render: r => r.fetchedAt ?? missing },
      { key: 'spend', label: t('Spend', 'Dépenses'), render: r => money(r.spend, r.currency) },
      { key: 'impressions', label: t('Impressions', 'Impressions'), render: r => number(r.impressions) },
      { key: 'clicks', label: t('Clicks', 'Clics'), render: r => number(r.clicks) },
      { key: 'reach', label: t('Reach snapshot', 'Portée instantanée'), render: r => number(r.reach) },
      { key: 'extra', label: t('Stored ratios, actions and additional fields', 'Ratios, actions et champs enregistrés'), render: r => <pre className={local.raw}>{JSON.stringify({ cpc: r.cpc, cpm: r.cpm, cpp: r.cpp, ctr: r.ctr, frequency: r.frequency, actions: r.actions, fields: r.fields, redactedPaths: r.redactedPaths }, (_key, v: unknown) => v === null ? missing : v, 2)}</pre> },
    ]} />
  </details>;
  return <PageFrame module="analytics" scopedAccess sidebar={sidebar}><div className={styles.root}><header className={styles.heading}><h1>{t('Ad-object analysis', 'Analyse des objets publicitaires')} · {levelLabel}</h1>
    <p>{d.period.start} – {d.period.end} · UTC</p>
    <p>{t('Figures sum stored daily reports only. Missing days are unknown. Levels overlap; never add campaigns, ad sets and ads together. Each object and account stays separate.', 'Les chiffres additionnent uniquement les rapports quotidiens enregistrés. Les jours manquants sont inconnus. Les niveaux se chevauchent ; ne cumulez pas campagnes, ensembles et publicités. Chaque objet et compte reste séparé.')}</p>
    <p>{t('Currency comes from current account metadata; no conversion or historical currency verification. Reach, frequency and cost per person are latest-day snapshots, not period totals. Additional measures remain unaggregated.', 'La devise provient des métadonnées actuelles du compte ; aucune conversion ni vérification historique. Portée, fréquence et coût par personne sont des instantanés du dernier jour, pas des totaux de période. Les mesures supplémentaires ne sont pas agrégées.')}</p>
  </header>
    <p role="status">{t('Accounts with matching stored data', 'Comptes avec données correspondantes')} {d.coverage.coveredAccounts} / {d.coverage.selectedAccounts} · {d.total} {t('objects', 'objets')} · {t('Objects with unknown parent', 'Objets au parent inconnu')} {d.coverage.unknownParentObjects}</p>
    <DataTable caption={levelLabel} rows={d.items} rowKey={r => r.key} emptyMessage={t('No stored objects for these filters. Try another account or period. Unknown parent links are excluded from drill-down.', 'Aucun objet enregistré pour ces filtres. Essayez un autre compte ou une autre période. Les parents inconnus sont exclus de l’exploration.')} columns={[
      { key: 'name', label: t('Object', 'Objet'), render: r => <><strong>{r.name}</strong><br />{r.accountName}<br />{r.objectId}</> },
      { key: 'spend', label: t('Stored spend', 'Dépenses enregistrées'), render: r => money(r.spend, r.currency) },
      { key: 'impressions', label: t('Impressions', 'Impressions'), render: r => number(r.impressions) },
      { key: 'clicks', label: t('Clicks', 'Clics'), render: r => number(r.clicks) },
      { key: 'ratios', label: t('Weighted ratios', 'Ratios pondérés'), render: r => <>{t('Cost per click', 'Coût par clic')} {money(r.cpc, r.currency)}<br />{t('Cost per 1000 impressions', 'Coût pour 1000 impressions')} {money(r.cpm, r.currency)}<br />{t('Click rate', 'Taux de clic')} {number(r.ctr)} %</> },
      { key: 'reach', label: t('Latest reach snapshot', 'Dernier instantané de portée'), render: r => <>{number(r.reach)}<br />{r.reachDate}</> },
      { key: 'coverage', label: t('Stored days / requested', 'Jours enregistrés / demandés'), render: r => <>{r.coveredDays} / {r.requestedDays}<br />{t('Last fetched UTC', 'Dernière collecte UTC')}: {r.lastFetchedAt ?? missing}</> },
      { key: 'drill', label: t('Explore', 'Explorer'), render: r => level !== 'ad' ? <a href={`?${query({ accountId: r.accountId, level: level === 'campaign' ? 'adset' : 'ad', parentId: r.objectId, objectId: null })}`}>{level === 'campaign' ? t('View ad sets', 'Voir les ensembles') : t('View ads', 'Voir les publicités')}</a> : missing },
      { key: 'details', label: t('Details', 'Détails'), render: details },
    ]} />
  </div></PageFrame>;
}
