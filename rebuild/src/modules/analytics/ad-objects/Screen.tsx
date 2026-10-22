import { analyticsCopy } from '../server/copy';
import { headers } from 'next/headers';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { InfoTip } from '@/components';
import type React from 'react';
import { readAdObjects } from './service';
import type { AdObject } from './aggregate';
import styles from '@/modules/analytics/ui/reports/workflows.module.css';
import local from './screen.module.css';

type Params = Record<string, string | string[] | undefined>;
export default async function AdObjectsScreen({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireViewer({ feature: 'analytics/ads', channelScoped: true });
  const fr = (await headers()).get('accept-language')?.startsWith('fr') ?? false;
  const { records: copy } = await analyticsCopy();
  const t = (key: keyof typeof copy) => copy[key][fr ? 'fr' : 'en'];
  const missing = t("Not available");
  const raw = await searchParams;
  let data: Awaited<ReturnType<typeof readAdObjects>> | undefined;
  try { data = await readAdObjects({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, raw); } catch { /* Localized recovery retains submitted values. */ }
  const value = (key: string) => { const v = raw[key]; return typeof v === 'string' ? v : ''; };
  const current = data?.input;
  const query = (patch: Record<string, string | null> = {}) => {
    const q = new URLSearchParams();
    q.set('start', data?.period.start ?? value('start')); q.set('end', data?.period.end ?? value('end'));
    q.set('level', current?.level ?? (value('level') || 'campaign'));
    for (const key of ['accountId', 'parentId', 'objectId', 'sort', 'direction'] as const) { const v = current?.[key] ?? value(key); if (v) q.set(key, v); }
    for (const [key, v] of Object.entries(patch)) { if (v === null) q.delete(key); else q.set(key, v); }
    return q.toString();
  };
  const number = (n: number | null | undefined) => n == null ? missing : new Intl.NumberFormat(fr ? 'fr' : 'en', { maximumFractionDigits: 2 }).format(n);
  const money = (n: number | null | undefined, currency: string | null) => `${number(n)} · ${currency || missing}`;
  const level = current?.level ?? (value('level') || 'campaign');
  const levelLabel = level === 'campaign' ? t("Campaigns") : level === 'adset' ? t("Ad sets") : t("Ads");
  const selectedAccount = current?.accountId ?? value('accountId');
  const options = data?.options ?? [];
  const info = <InfoTip name={t("Ad-object analysis")} blocks={[
    { text: t("Figures sum stored daily reports only. Missing days are unknown. Levels overlap; never add campaigns, ad sets and ads together. Each object and account stays separate.") },
    { text: t("Currency comes from current account metadata; no conversion or historical currency verification. Reach, frequency and cost per person are latest-day snapshots, not period totals. Additional measures remain unaggregated.") },
  ]} />;
  const field = (label: string, control: React.ReactNode) => <label className={local.field}><span>{label}</span>{control}</label>;
  const sidebar = <form action="/ads/analysis" className={local.filters} aria-label={t("Ad-object analysis")}>
    {field(t("Start (UTC, inclusive)"), <input type="text" name="start" size={10} placeholder={t("YYYY-MM-DD")} defaultValue={data?.period.start ?? value('start')} />)}
    {field(t("End (UTC, inclusive)"), <input type="text" name="end" size={10} placeholder={t("YYYY-MM-DD")} defaultValue={data?.period.end ?? value('end')} />)}
    {field(t("Ad account"), <select name="accountId" defaultValue={selectedAccount}>
      <option value="">{t("All accessible accounts")}</option>
      {selectedAccount && !options.some(a => a.id === selectedAccount) && <option value={selectedAccount}>{selectedAccount} · {missing}</option>}
      {options.map(a => <option key={a.id} value={a.id}>{a.name} · {a.currency || missing}</option>)}
    </select>)}
    {field(t("Level"), <select name="level" defaultValue={level}><option value="campaign">{t("Campaigns")}</option><option value="adset">{t("Ad sets")}</option><option value="ad">{t("Ads")}</option></select>)}
    {field(t("Sort by"), <select name="sort" defaultValue={current?.sort ?? (value('sort') || 'name')}>
      {([['name', t("Name")], ['spend', t("Spend")], ['impressions', t("Impressions")], ['clicks', t("Clicks")], ['ctr', t("Click rate")], ['cpc', t("Cost per click")], ['cpm', t("Cost per 1000 impressions")], ['reach', t("Reach snapshot")], ['coveredDays', t("Stored days")], ['lastFetchedAt', t("Last fetched UTC")]]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>)}
    {field(t("Order"), <select name="direction" defaultValue={current?.direction ?? (value('direction') || 'asc')}><option value="asc">{t("Ascending")}</option><option value="desc">{t("Descending")}</option></select>)}
    {field(t("Parent ID (optional; select one account)"), <input name="parentId" size={10} defaultValue={current?.parentId ?? value('parentId')} />)}
    {field(t("Object ID (optional; select one account)"), <input name="objectId" size={10} defaultValue={current?.objectId ?? value('objectId')} />)}
    <div className={local.submit}><Button type="submit" variant="primary" size="sm">{t("Apply")}</Button><a href="/ads/analysis">{t("Reset filters")}</a></div>
  </form>;
  const header = <PageHeader title={t("Ad-object analysis")} info={info} />;
  if (!data) return <PageFrame module="analytics" scopedAccess><div className={local.content}>{header}{sidebar}<section role="alert" className={local.alert}><h2>{t("Ad-object analysis unavailable")}</h2><p>{t("Check your access and filters, or choose a shorter period, then try again.")}</p></section></div></PageFrame>;
  const d = data;
  const details = (item: AdObject) => <details><summary>{t("Stored daily details")}<span className="ui-visually-hidden"> · {item.name}</span></summary>
    <DataTable caption={`${t("Daily measures")} · ${item.name}`} rows={item.daily} rowKey={row => row.id} columns={[
      { key: 'day', label: t("Day UTC"), render: r => r.date },
      { key: 'fetch', label: t("Fetched UTC"), render: r => r.fetchedAt ?? missing },
      { key: 'spend', label: t("Spend"), render: r => money(r.spend, r.currency) },
      { key: 'impressions', label: t("Impressions"), render: r => number(r.impressions) },
      { key: 'clicks', label: t("Clicks"), render: r => number(r.clicks) },
      { key: 'reach', label: t("Reach snapshot"), render: r => number(r.reach) },
      { key: 'extra', label: t("Stored ratios, actions and additional fields"), render: r => <pre className={local.raw}>{JSON.stringify({ cpc: r.cpc, cpm: r.cpm, cpp: r.cpp, ctr: r.ctr, frequency: r.frequency, actions: r.actions, fields: r.fields, redactedPaths: r.redactedPaths }, (_key, v: unknown) => v === null ? missing : v, 2)}</pre> },
    ]} />
  </details>;
  return <PageFrame module="analytics" scopedAccess><div className={`${styles.root} ${local.content}`}>{header}{sidebar}
    <div className={local.status}>
      <p role="status"><strong>{levelLabel}</strong> · {d.period.start} – {d.period.end} UTC · {t("Accounts with matching stored data")} {d.coverage.coveredAccounts} / {d.coverage.selectedAccounts} · {d.total} {t("objects")} · {t("Objects with unknown parent")} {d.coverage.unknownParentObjects}</p>
      <div className={local.links}>
        {level !== 'campaign' && <nav aria-label={t("Drill-down")}><a href={`?${query({ level: 'campaign', parentId: null, objectId: null })}`}>{t("Back to campaigns")}</a></nav>}
        <a className="ui-button ui-button--secondary ui-button--sm" download href={`/api/analytics/ad-objects?${query({ format: 'csv', locale: fr ? 'fr' : 'en' })}`}>{t("Export selection (CSV)")}</a>
      </div>
    </div>
    <DataTable caption={levelLabel} rows={d.items} rowKey={r => r.key} emptyMessage={t("No stored objects for these filters. Try another account or period. Unknown parent links are excluded from drill-down.")} columns={[
      { key: 'name', label: t("Object"), render: r => <span className={`${local.object} ${local.name}`}><strong>{r.name}</strong><small>{r.accountName} · {r.objectId}</small></span> },
      { key: 'spend', label: t("Stored spend"), render: r => money(r.spend, r.currency) },
      { key: 'impressions', label: t("Impressions"), render: r => number(r.impressions) },
      { key: 'clicks', label: t("Clicks"), render: r => number(r.clicks) },
      { key: 'ratios', label: t("Weighted ratios"), render: r => <dl className={local.ratios}><dt>{t("Cost per click")}</dt><dd>{money(r.cpc, r.currency)}</dd><dt>{t("Cost per 1000 impressions")}</dt><dd>{money(r.cpm, r.currency)}</dd><dt>{t("Click rate")}</dt><dd>{number(r.ctr)}{fr ? '\u202f' : ''}%</dd></dl> },
      { key: 'reach', label: t("Latest reach snapshot"), render: r => <span className={local.object}>{number(r.reach)}<small>{r.reachDate?.slice(0, 10)}</small></span> },
      { key: 'coverage', label: t("Stored days / requested"), render: r => <span className={local.object}>{r.coveredDays} / {r.requestedDays}<small>{t("Last fetched UTC")}{fr ? '\u202f' : ''}: {r.lastFetchedAt?.replace('T', ' ').slice(0, 16) ?? missing}</small></span> },
      { key: 'drill', label: t("Explore"), render: r => level !== 'ad' ? <a href={`?${query({ accountId: r.accountId, level: level === 'campaign' ? 'adset' : 'ad', parentId: r.objectId, objectId: null })}`}>{level === 'campaign' ? t("View ad sets") : t("View ads")}</a> : missing },
      { key: 'details', label: t("Details"), render: details },
    ]} />
    <p className={local.hint}>{t("Sorted within each account and currency. Missing values appear last.")}</p>
    {(d.page > 1 || d.nextPage) && <nav aria-label={t("Pages")} className={styles.pager}>{d.page > 1 && <a href={`?${query({ page: String(d.page - 1) })}`}>{t("Previous")}</a>}<span>{t("Page")} {d.page}</span>{d.nextPage && <a href={`?${query({ page: String(d.nextPage) })}`}>{t("Next")}</a>}</nav>}
  </div></PageFrame>;
}
