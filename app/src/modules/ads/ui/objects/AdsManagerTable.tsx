'use client';
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { IconArrowDown, IconArrowUp, IconChevronRight, IconFolder, IconLayoutGrid, IconPhoto, IconSearch, IconX } from '@tabler/icons-react';
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
    selectAll: 'Select all', selectRow: 'Select {name}', selected: '{count} selected', bulkOn: 'Turn on', bulkOff: 'Turn off', bulkClear: 'Clear selection',
    bulkOnTitle: 'Turn on {count} items?', bulkOnBody: 'They can start delivering and spending their budgets again.', bulkDone: '{count} updated.', bulkPartial: '{done} of {count} updated. Check Ads › History for the others.',
    forParent: 'for 1 {parent}', levels: 'Levels', sortBy: 'Sort by {column}',
  },
  fr: {
    campaign: 'Campagne', adset: 'Ensemble de publicités', ad: 'Publicité', campaigns: 'Campagnes', adsets: 'Ensembles de publicités', ads: 'Publicités',
    onOff: 'Désactivé / Activé', delivery: 'Diffusion', spent: 'Montant dépensé', impressions: 'Impressions', clicks: 'Clics', ctr: 'CTR', cpc: 'CPC', cpm: 'CPM', last: 'Dernière diffusion',
    active: 'Active', paused: 'Désactivée', notDelivering: 'Pas de diffusion', deleted: 'Supprimée', archived: 'Archivée', unknown: 'Inconnu',
    noDelivery: 'Pas de diffusion depuis le {date}', in: 'dans {parent}', totals: 'Résultats de {count} {items}', search: 'Rechercher par nom', clear: 'Effacer',
    turnOnTitle: 'Activer cet élément ?', turnOnBody: '« {name} » peut de nouveau diffuser et dépenser son budget.', turnOn: 'Activer', cancel: 'Annuler',
    turning: 'Enregistrement…', turnedOn: '{name} est activé.', turnedOff: '{name} est désactivé.', failed: 'La modification n’a pas pu être confirmée. Vérifiez Publicités › Historique avant de réessayer.', busyElsewhere: 'Une autre modification de cet élément est en cours.',
    viewAdsets: 'Voir les ensembles', viewAds: 'Voir les publicités', empty: 'Aucun élément pour cette période et ce filtre.', switchLabel: 'Activer ou désactiver {name}',
    selectAll: 'Tout sélectionner', selectRow: 'Sélectionner {name}', selected: '{count} sélectionné(s)', bulkOn: 'Activer', bulkOff: 'Désactiver', bulkClear: 'Effacer la sélection',
    bulkOnTitle: 'Activer {count} éléments ?', bulkOnBody: 'Ils peuvent de nouveau diffuser et dépenser leur budget.', bulkDone: '{count} mis à jour.', bulkPartial: '{done} sur {count} mis à jour. Vérifiez Publicités › Historique pour les autres.',
    forParent: 'pour 1 {parent}', levels: 'Niveaux', sortBy: 'Trier par {column}',
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

/** One on/off change through the reviewed management path: preview for the exact confirmation, then apply. */
async function setStatus(row: ManagerRow, level: ManagerLevel, next: 'active' | 'paused', t: Copy) {
  const operation = { type: 'status.set', objectType: level, objectId: row.objectId, status: next };
  const previewResponse = await fetch('/api/ads/management', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'preview', adAccountId: row.accountId, operation }) });
  const preview = await previewResponse.json().catch(() => ({})) as { confirmation?: string; blockedByOpenChange?: boolean | null; error?: string };
  if (!previewResponse.ok || typeof preview.confirmation !== 'string') throw new Error(preview.error || t.failed);
  if (preview.blockedByOpenChange !== false) throw new Error(t.busyElsewhere);
  const response = await fetch('/api/ads/management', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'apply', adAccountId: row.accountId, operation, confirmation: preview.confirmation, requestId: globalThis.crypto.randomUUID() }) });
  const payload = await response.json().catch(() => null) as { outcome?: string; message?: string } | null;
  if (!response.ok || payload?.outcome !== 'succeeded') throw new Error(payload?.message || t.failed);
  patchObjectRow(row.accountId, level, row.objectId, { status: next });
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
      await setStatus(row, level, next, t);
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

export type LevelTab = { id: ManagerLevel; href: string; active: boolean };
export type SortKey = 'name' | 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'cpm';
const LEVEL_ICON = { campaign: IconFolder, adset: IconLayoutGrid, ad: IconPhoto } as const;

export function AdsManagerTable({ level, rows, locale, money, number, drillHref, parent, clearParentHref, searchQuery, searchAction, hiddenParams, edit, canManage, createButton, levelTabs, moreTabs, rangeLabel, sort, sortHref }: {
  level: ManagerLevel; rows: ManagerRow[]; locale: 'en' | 'fr';
  money: Record<string, string>; number: Record<string, string>;
  /** Next level for a row (campaign → its ad sets, ad set → its ads); none for ads. */
  drillHref: Record<string, string>;
  parent: { level: ManagerLevel; name: string } | null; clearParentHref: string;
  searchQuery: string; searchAction: string; hiddenParams: Record<string, string>;
  edit: Record<string, ReactNode>; canManage: Record<string, boolean>; createButton?: ReactNode;
  /** Campaigns / Ad sets / Ads, as the tab cards above Meta's table. */
  levelTabs: LevelTab[]; moreTabs?: ReactNode; rangeLabel?: string;
  sort: { key: SortKey; direction: 'asc' | 'desc' }; sortHref: Record<SortKey, string>;
}) {
  const t: Copy = COPY[locale];
  const items = level === 'campaign' ? t.campaigns : level === 'adset' ? t.adsets : t.ads;
  const [query, setQuery] = useState(searchQuery);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const [confirmBulk, bulkDialog] = useConfirm({ title: fill(t.bulkOnTitle, { count: selected.size }), cancel: t.cancel, confirm: t.bulkOn, danger: false });
  const selectable = rows.filter(row => canManage[row.accountId]);
  const allSelected = selectable.length > 0 && selectable.every(row => selected.has(row.key));
  const toggleRow = (key: string) => setSelected(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  async function bulk(next: 'active' | 'paused') {
    const chosen = rows.filter(row => selected.has(row.key) && canManage[row.accountId]);
    if (!chosen.length || bulkBusy) return;
    // Turning on can start spending, so it is confirmed once for the whole selection.
    if (next === 'active' && !(await confirmBulk(t.bulkOnBody))) return;
    setBulkBusy(true);
    let done = 0;
    // One change at a time: each goes through its own preview and confirmation, like a single switch.
    for (const row of chosen) { try { await setStatus(row, level, next, t); done += 1; } catch { /* reported below */ } }
    setBulkBusy(false);
    if (done === chosen.length) { toast.notify({ tone: 'success', title: fill(t.bulkDone, { count: done }) }); setSelected(new Set()); }
    else toast.failed(fill(t.bulkPartial, { done, count: chosen.length }), () => window.location.assign('/ads/manage?level=history'), locale === 'fr' ? 'Historique' : 'History');
    router.refresh();
  }
  const sum = (key: 'spend' | 'impressions' | 'clicks') => rows.reduce((total, row) => total + row[key], 0);
  const currencies = [...new Set(rows.map(row => row.currency).filter(Boolean))];
  const totalSpend = currencies.length <= 1 ? new Intl.NumberFormat(locale, { style: 'currency', currency: currencies[0] ?? 'USD' }).format(sum('spend')) : '—';
  const totalImpressions = sum('impressions'); const totalClicks = sum('clicks');
  const fmt = new Intl.NumberFormat(locale);
  const head = (key: SortKey, label: string, numeric = true) => {
    const active = sort.key === key;
    const Arrow = sort.direction === 'asc' ? IconArrowUp : IconArrowDown;
    return <th scope="col" className={numeric ? 'is-num' : 'am-col-name'} aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
      <a className="am-sort" href={sortHref[key]} title={fill(t.sortBy, { column: label })}>{label}{active ? <Arrow size={12} aria-hidden="true" /> : null}</a>
    </th>;
  };
  return <div className="am">
    <nav className="am-levels" aria-label={t.levels}>
      {levelTabs.map(tab => {
        const Icon = LEVEL_ICON[tab.id];
        const label = tab.id === 'campaign' ? t.campaigns : tab.id === 'adset' ? t.adsets : t.ads;
        const scoped = tab.active && parent ? fill(t.forParent, { parent: t[parent.level].toLowerCase() }) : null;
        return <a key={tab.id} href={tab.href} className="am-level" aria-current={tab.active ? 'page' : undefined}><Icon size={18} aria-hidden="true" /><span>{label}</span>{scoped ? <small>{scoped}</small> : null}</a>;
      })}
      {moreTabs ? <div className="am-levels__more">{moreTabs}</div> : null}
    </nav>
    <div className="am-toolbar">
      {selected.size ? <div className="am-bulk" role="group" aria-label={fill(t.selected, { count: selected.size })}>
        <strong>{fill(t.selected, { count: selected.size })}</strong>
        <button type="button" className="ui-button ui-button--secondary ui-button--sm" disabled={bulkBusy} onClick={() => void bulk('paused')}>{bulkBusy ? t.turning : t.bulkOff}</button>
        <button type="button" className="ui-button ui-button--secondary ui-button--sm" disabled={bulkBusy} onClick={() => void bulk('active')}>{t.bulkOn}</button>
        <button type="button" className="am-link" disabled={bulkBusy} onClick={() => setSelected(new Set())}>{t.bulkClear}</button>
      </div> : <>
        {createButton}
        <form className="am-search" action={searchAction} method="get" role="search">
          {Object.entries(hiddenParams).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
          <IconSearch size={16} aria-hidden="true" />
          <input type="search" name="q" value={query} onChange={event => setQuery(event.target.value)} placeholder={t.search} aria-label={t.search} />
        </form>
        {parent ? <a className="am-chip" href={clearParentHref}><span>{t[parent.level]}: <strong>{parent.name}</strong></span><IconX size={14} aria-label={t.clear} /></a> : null}
      </>}
      {rangeLabel ? <span className="am-range">{rangeLabel}</span> : null}
    </div>
    <div className="am-table-wrap" role="region" aria-label={items} tabIndex={0}>
      <table className="am-table">
        <thead><tr>
          <th scope="col" className="am-col-check"><input type="checkbox" aria-label={t.selectAll} checked={allSelected} disabled={!selectable.length || bulkBusy} onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map(row => row.key)))} /></th>
          <th scope="col" className="am-col-switch">{t.onOff}</th>
          {head('name', t[level], false)}
          <th scope="col">{t.delivery}</th>
          {head('spend', t.spent)}
          {head('impressions', t.impressions)}
          {head('clicks', t.clicks)}
          {head('ctr', t.ctr)}
          {head('cpc', t.cpc)}
          {head('cpm', t.cpm)}
          <th scope="col">{t.last}</th>
        </tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={11} className="am-empty">{fill(t.empty, { items: items.toLowerCase() })}</td></tr> : rows.map(row => <Row key={row.key} row={row} level={level} locale={locale} t={t} money={money} number={number} drill={drillHref[row.key]} edit={edit[row.key]} canManage={canManage[row.accountId] ?? false} checked={selected.has(row.key)} onCheck={() => toggleRow(row.key)} busy={bulkBusy} />)}
        </tbody>
        {rows.length ? <tfoot><tr>
          <td /><td />
          <th scope="row" className="am-col-name">{fill(t.totals, { count: fmt.format(rows.length), items: (rows.length === 1 ? t[level] : items).toLowerCase() })}</th>
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
    {bulkDialog}
  </div>;
}

function Row({ row, level, locale, t, money, number, drill, edit, canManage, checked, onCheck, busy }: { row: ManagerRow; level: ManagerLevel; locale: 'en' | 'fr'; t: Copy; money: Record<string, string>; number: Record<string, string>; drill?: string; edit?: ReactNode; canManage: boolean; checked: boolean; onCheck: () => void; busy: boolean }) {
  const overlay = useObjectRowOverlay(row.accountId, level, row.objectId);
  const name = overlay?.name ?? row.name;
  const state = delivery(row, overlay?.status ?? row.status, t);
  const day = (iso: string | null) => iso ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`)) : '—';
  return <tr className={checked ? 'is-selected' : undefined}>
    <td className="am-col-check"><input type="checkbox" aria-label={fill(t.selectRow, { name })} checked={checked} disabled={!canManage || busy} onChange={onCheck} /></td>
    <td className="am-col-switch"><DeliverySwitch row={row} level={level} locale={locale} t={t} canManage={canManage} /></td>
    <td className="am-col-name">
      <div className="am-name">{drill ? <a href={drill}>{name}<IconChevronRight size={14} aria-hidden="true" /></a> : <span>{name}</span>}</div>
      <div className="am-slot"><div className="am-sub">{row.parentName ? fill(t.in, { parent: row.parentName }) : row.accountName}</div>
      <div className="am-actions">{edit}{drill ? <a href={drill}>{level === 'campaign' ? t.viewAdsets : t.viewAds}</a> : null}</div></div>
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
