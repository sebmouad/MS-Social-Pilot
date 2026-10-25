'use client';
import { useState } from 'react';
import { Badge } from '@/components/Badge';
import { DataTable, type TableColumn } from '@/components/DataTable';
import { SidePanel } from '@/components/SidePanel';
import type { AdsSummary } from '@/modules/ads/server/summary';
import { AccountCharts } from './AccountCharts';
import { DailyMetrics } from './DailyMetrics';
import { fillAds, type AdsInsightsCopy } from './ads-insights';
import './ads.css';

export type AccountRow = {
  id: string; name: string; actId: string; currency: string | null; enabled: boolean; lastSyncedAt: string | null;
  /** Stored results for the period; null when the account has none (unknown, not zero). */
  summary: AdsSummary | null;
};

/**
 * Ads › Accounts: one row per ad account, never a wall of tiles. A row opens a side panel with the spend
 * chart, the funnel and the reported actions; currencies stay per row and are never summed.
 */
export function AccountsTable({ rows, copy, locale, campaignsHref, rowLabel }: { rows: AccountRow[]; copy: AdsInsightsCopy; locale: 'en' | 'fr'; campaignsHref: string; rowLabel: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find(row => row.id === openId) ?? null;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const money = (value: number | null, currency: string | null) => value === null ? '—' : currency ? new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value) : number.format(value);
  const when = (value: string | null) => value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : copy.neverSynced;
  const columns: TableColumn<AccountRow>[] = [
    { key: 'account', label: copy.colAccount, hideCardLabel: true, render: row => <div className="insights-accounts__name"><button type="button" aria-label={fillAds(copy.openDetails, { name: row.name })} onClick={() => setOpenId(row.id)}>{row.name}</button><small>{row.actId}{row.currency ? ` · ${row.currency}` : ''}</small></div> },
    { key: 'status', label: copy.colStatus, render: row => <Badge tone={row.enabled ? 'success' : 'neutral'}>{row.enabled ? copy.statusActive : copy.statusOff}</Badge> },
    { key: 'spend', label: copy.colSpend, align: 'end', render: row => <span className="insights-num">{row.summary ? money(row.summary.spend, row.currency) : '—'}</span> },
    { key: 'impressions', label: copy.colImpressions, align: 'end', render: row => <span className="insights-num">{row.summary ? number.format(row.summary.impressions) : '—'}</span> },
    { key: 'clicks', label: copy.colClicks, align: 'end', render: row => <span className="insights-num">{row.summary ? number.format(row.summary.clicks) : '—'}</span> },
    { key: 'ctr', label: copy.colCtr, align: 'end', render: row => <span className="insights-num">{row.summary?.ctr == null ? '—' : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(row.summary.ctr / 100)}</span> },
    { key: 'cpc', label: copy.colCpc, align: 'end', render: row => <span className="insights-num">{row.summary ? money(row.summary.cpc, row.currency) : '—'}</span> },
    { key: 'synced', label: copy.colSynced, render: row => when(row.lastSyncedAt) },
  ];
  return <div className="insights-accounts-split" data-open={open !== null}>
    <div className="insights-accounts-split__list"><DataTable columns={columns} rows={rows} rowKey={row => row.id} caption={copy.caption} density="compact" onRowClick={row => setOpenId(row.id)} /></div>
    <SidePanel open={open !== null} title={open?.name ?? rowLabel} onClose={() => setOpenId(null)} closeLabel={copy.detailsClose}
      actions={open ? <a className="ui-button ui-button--secondary ui-button--md" href={campaignsHref}>{copy.detailsCampaigns}</a> : undefined}>
      {open && <div className="insights-detail">
        {open.summary
          ? <>
            <AccountCharts row={open.summary} locale={locale} />
            <section><h3>{copy.detailsActions}</h3>
              {open.summary.actions.length
                ? <ul>{open.summary.actions.map(action => <li key={action.name}><span>{action.name}</span> <strong className="insights-num">{number.format(action.value)}</strong></li>)}</ul>
                : <p className="small-note">{copy.detailsNoActions}</p>}
            </section>
            <DailyMetrics rows={open.summary.dailyMetrics} currency={open.currency} />
          </>
          : <p className="small-note">{copy.noResults}</p>}
      </div>}
    </SidePanel>
  </div>;
}
