'use client';
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { IconChevronRight, IconSearch, IconX } from '@tabler/icons-react';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/useConfirm';
import { patchObjectRow, useObjectRowOverlay } from './row-state';

export type ManagerLevel = 'campaign' | 'adset' | 'ad';
export type ManagerRow = {
  key: string; accountId: string; accountName: string; objectId: string; name: string; status: string | null; currency: string | null;
  spend: number; impressions: number; clicks: number; ctr: number | null; cpc: number | null; cpm: number | null;
  lastDeliveryDate: string | null; lastFetchedAt: string | null; parentId: string | null; parentName: string | null;
};

const COPY = {
  en: {
    campaign: 'Campaign', adset: 'Ad set', ad: 'Ad', campaigns: 'Campaigns', adsets: 'Ad sets', ads: 'Ads',
    onOff: 'Off / On', delivery: 'Delivery', spent: 'Amount spent', impressions: 'Impressions', clicks: 'Clicks', ctr: 'CTR', cpc: 'CPC', cpm: 'CPM', last: 'Last delivery',
    active: 'Active', paused: 'Off', notDelivering: 'Not delivering', deleted: 'Deleted', archived: 'Archived', unknown: 'Unknown',
    noDelivery: 'No delivery since {date}', in: 'in {parent}', totals: 'Results from {count} {items}', search: 'Search by name', clear: 'Clear',
    turnOnTitle: 'Turn on this {kind}?', turnOnBody: '« {name} » can start delivering and spending its budget again.', turnOn: 'Turn on', cancel: 'Cancel',
    turning: 'Saving…', turnedOn: '{name} is on.', turnedOff: '{name} is off.', failed: 'The change could not be confirmed. Check Ads › History before trying again.', busyElsewhere: 'Another change to this item is still being applied.',
    viewAdsets: 'View ad sets', viewAds: 'View ads', empty: 'No {items} for this period and filter.', switchLabel: 'Turn {name} on or off',
  },
  fr: {
    campaign: 'Campagne', adset: 'Ensemble de publicités', ad: 'Publicité', campaigns: 'Campagnes', adsets: 'Ensembles de publicités', ads: 'Publicités',
    onOff: 'Désactivé / Activé', delivery: 'Diffusion', spent: 'Montant dépensé', impressions: 'Impressions', clicks: 'Clics', ctr: 'CTR', cpc: 'CPC', cpm: 'CPM', last: 'Dernière diffusion',
    active: 'Active', paused: 'Désactivée', notDelivering: 'Pas de diffusion', deleted: 'Supprimée', archived: 'Archivée', unknown: 'Inconnu',
    noDelivery: 'Pas de diffusion depuis le {date}', in: 'dans {parent}', totals: 'Résultats de {count} {items}', search: 'Rechercher par nom', clear: 'Effacer',
    turnOnTitle: 'Activer cet élément ?', turnOnBody: '« {name} » peut de nouveau diffuser et dépenser son budget.', turnOn: 'Activer', cancel: 'Annuler',
    turning: 'Enregistrement…', turnedOn: '{name} est activé.', turnedOff: '{name} est désactivé.', failed: 'La modification n’a pas pu être confirmée. Vérifiez Publicités › Historique avant de réessayer.', busyElsewhere: 'Une autre modification de cet élément est en cours.',
    viewAdsets: 'Voir les ensembles', viewAds: 'Voir les publicités', empty: 'Aucun élément pour cette période et ce filtre.', switchLabel: 'Activer ou désactiver {name}',
  },
} as const;
type Copy = { [K in keyof typeof COPY.en]: string };
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (all, key: string) => key in values ? String(values[key]) : all);

/** Delivery as Meta Ads Manager shows it: a dot and a word, with « not delivering » when an active item has stopped spending. */
function delivery(row: ManagerRow, status: string | null, t: Copy) {
  const value = (status ?? '').toLowerCase();
  if (value === 'active') {
    const quiet = row.lastFetchedAt && (!row.lastDeliveryDate || Date.parse(row.lastFetchedAt) - Date.parse(row.lastDeliveryDate) > 2 * 86_400_000);
    return quiet ? { tone: 'warn', label: t.notDelivering } : { tone: 'on', label: t.active };
  }
  if (value === 'paused' || value === 'campaign_paused' || value === 'adset_paused') return { tone: 'off', label: t.paused };
  if (value === 'deleted') return { tone: 'off', label: t.deleted };
  if (value === 'archived') return { tone: 'off', label: t.archived };
  return { tone: 'off', label: status || t.unknown };
}

function DeliverySwitch({ row, level, locale, t, canManage }: { row: ManagerRow; level: ManagerLevel; locale: 'en' | 'fr'; t: Copy; canManage: boolean }) {
  const overlay = useObjectRowOverlay(row.accountId, level, row.objectId);
  const status = (overlay?.status ?? row.status ?? '').toLowerCase();
  const on = status === 'active';
  const switchable = canManage && (status === 'active' || status === 'paused');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const [confirm, dialog] = useConfirm({ title: fill(t.turnOnTitle, { kind: t[level].toLowerCase() }), cancel: t.cancel, confirm: t.turnOn, danger: false });
  async function change(next: 'active' | 'paused') {
    setBusy(true);
    try {
      const operation = { type: 'status.set', objectType: level, objectId: row.objectId, status: next };
      const previewResponse = await fetch('/api/ads/management', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'preview', adAccountId: row.accountId, operation }) });
      const preview = await previewResponse.json().catch(() => ({})) as { confirmation?: string; blockedByOpenChange?: boolean | null; error?: string };
      if (!previewResponse.ok || typeof preview.confirmation !== 'string') throw new Error(preview.error || t.failed);
      if (preview.blockedByOpenChange !== false) throw new Error(t.busyElsewhere);
      const response = await fetch('/api/ads/management', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'apply', adAccountId: row.accountId, operation, confirmation: preview.confirmation, requestId: globalThis.crypto.randomUUID() }) });
      const payload = await response.json().catch(() => null) as { outcome?: string; message?: string } | null;
      if (!response.ok || payload?.outcome !== 'succeeded') throw new Error(payload?.message || t.failed);
      patchObjectRow(row.accountId, level, row.objectId, { status: next });
      toast.notify({ tone: 'success', title: fill(next === 'active' ? t.turnedOn : t.turnedOff, { name: row.name }) });
      router.refresh();
    } catch (error) {
      toast.failed(error instanceof Error ? error.message : t.failed, () => window.location.assign('/ads/manage?level=history'), locale === 'fr' ? 'Historique' : 'History');
    } finally { setBusy(false); }
  }
  async function toggle() {
    if (busy || !switchable) return;
    if (on) { await change('paused'); return; }
    // Turning something on can start spending, so it is confirmed first; turning it off stops spending and is immediate.
    if (await confirm(fill(t.turnOnBody, { name: row.name }))) await change('active');
  }
  return <>
    <button type="button" role="switch" aria-checked={on} aria-label={fill(t.switchLabel, { name: row.name })} className="am-switch" disabled={!switchable || busy} aria-busy={busy || undefined} onClick={() => void toggle()}><span /></button>
    {dialog}
  </>;
}

export function AdsManagerTable({ level, rows, locale, money, number, drillHref, parent, clearParentHref, searchQuery, searchAction, hiddenParams, edit, canManage, createButton }: {
  level: ManagerLevel; rows: ManagerRow[]; locale: 'en' | 'fr';
  money: Record<string, string>; number: Record<string, string>;
  /** Next level for a row (campaign → its ad sets, ad set → its ads); none for ads. */
  drillHref: Record<string, string>;
  parent: { level: ManagerLevel; name: string } | null; clearParentHref: string;
  searchQuery: string; searchAction: string; hiddenParams: Record<string, string>;
  edit: Record<string, ReactNode>; canManage: Record<string, boolean>; createButton?: ReactNode;
}) {
  const t: Copy = COPY[locale];
  const items = level === 'campaign' ? t.campaigns : level === 'adset' ? t.adsets : t.ads;
  const [query, setQuery] = useState(searchQuery);
  const sum = (key: 'spend' | 'impressions' | 'clicks') => rows.reduce((total, row) => total + row[key], 0);
  const currencies = [...new Set(rows.map(row => row.currency).filter(Boolean))];
  const totalSpend = currencies.length <= 1 ? new Intl.NumberFormat(locale, { style: 'currency', currency: currencies[0] ?? 'USD' }).format(sum('spend')) : '—';
  const totalImpressions = sum('impressions'); const totalClicks = sum('clicks');
  const fmt = new Intl.NumberFormat(locale);
  return <div className="am">
    <div className="am-toolbar">
      {createButton}
      <form className="am-search" action={searchAction} method="get" role="search">
        {Object.entries(hiddenParams).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
        <IconSearch size={16} aria-hidden="true" />
        <input type="search" name="q" value={query} onChange={event => setQuery(event.target.value)} placeholder={t.search} aria-label={t.search} />
      </form>
      {parent ? <a className="am-chip" href={clearParentHref}><span>{t[parent.level]}: <strong>{parent.name}</strong></span><IconX size={14} aria-label={t.clear} /></a> : null}
    </div>
    <div className="am-table-wrap" role="region" aria-label={items} tabIndex={0}>
      <table className="am-table">
        <thead><tr>
          <th scope="col" className="am-col-switch">{t.onOff}</th>
          <th scope="col" className="am-col-name">{t[level]}</th>
          <th scope="col">{t.delivery}</th>
          <th scope="col" className="is-num">{t.spent}</th>
          <th scope="col" className="is-num">{t.impressions}</th>
          <th scope="col" className="is-num">{t.clicks}</th>
          <th scope="col" className="is-num">{t.ctr}</th>
          <th scope="col" className="is-num">{t.cpc}</th>
          <th scope="col" className="is-num">{t.cpm}</th>
          <th scope="col">{t.last}</th>
        </tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={10} className="am-empty">{fill(t.empty, { items: items.toLowerCase() })}</td></tr> : rows.map(row => <Row key={row.key} row={row} level={level} locale={locale} t={t} money={money} number={number} drill={drillHref[row.key]} edit={edit[row.key]} canManage={canManage[row.accountId] ?? false} />)}
        </tbody>
        {rows.length ? <tfoot><tr>
          <td />
          <th scope="row" className="am-col-name">{fill(t.totals, { count: fmt.format(rows.length), items: items.toLowerCase() })}</th>
          <td />
          <td className="is-num">{totalSpend}</td>
          <td className="is-num">{fmt.format(totalImpressions)}</td>
          <td className="is-num">{fmt.format(totalClicks)}</td>
          <td className="is-num">{totalImpressions ? `${(totalClicks / totalImpressions * 100).toFixed(2)}%` : '—'}</td>
          <td className="is-num">{currencies.length <= 1 && totalClicks ? new Intl.NumberFormat(locale, { style: 'currency', currency: currencies[0] ?? 'USD' }).format(sum('spend') / totalClicks) : '—'}</td>
          <td className="is-num">{currencies.length <= 1 && totalImpressions ? new Intl.NumberFormat(locale, { style: 'currency', currency: currencies[0] ?? 'USD' }).format(sum('spend') / totalImpressions * 1000) : '—'}</td>
          <td />
        </tr></tfoot> : null}
      </table>
    </div>
  </div>;
}

function Row({ row, level, locale, t, money, number, drill, edit, canManage }: { row: ManagerRow; level: ManagerLevel; locale: 'en' | 'fr'; t: Copy; money: Record<string, string>; number: Record<string, string>; drill?: string; edit?: ReactNode; canManage: boolean }) {
  const overlay = useObjectRowOverlay(row.accountId, level, row.objectId);
  const name = overlay?.name ?? row.name;
  const state = delivery(row, overlay?.status ?? row.status, t);
  const day = (iso: string | null) => iso ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`)) : '—';
  return <tr className={state.tone === 'on' ? 'is-on' : undefined}>
    <td className="am-col-switch"><DeliverySwitch row={row} level={level} locale={locale} t={t} canManage={canManage} /></td>
    <td className="am-col-name">
      <div className="am-name">{drill ? <a href={drill}>{name}<IconChevronRight size={14} aria-hidden="true" /></a> : <span>{name}</span>}</div>
      <div className="am-sub">{row.parentName ? fill(t.in, { parent: row.parentName }) : row.accountName}</div>
      <div className="am-actions">{edit}{drill ? <a href={drill}>{level === 'campaign' ? t.viewAdsets : t.viewAds}</a> : null}</div>
    </td>
    <td><span className={`am-dot am-dot--${state.tone}`} aria-hidden="true" />{state.label}{state.tone === 'warn' && row.lastDeliveryDate ? <div className="am-sub">{fill(t.noDelivery, { date: day(row.lastDeliveryDate) })}</div> : null}</td>
    <td className="is-num">{money[row.key]}</td>
    <td className="is-num">{number[`${row.key}:impressions`]}</td>
    <td className="is-num">{number[`${row.key}:clicks`]}</td>
    <td className="is-num">{row.ctr === null ? '—' : `${row.ctr.toFixed(2)}%`}</td>
    <td className="is-num">{number[`${row.key}:cpc`]}</td>
    <td className="is-num">{number[`${row.key}:cpm`]}</td>
    <td>{day(row.lastDeliveryDate)}</td>
  </tr>;
}
