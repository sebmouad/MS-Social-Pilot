'use client';
import { useAdsText } from '@/modules/ads/ui/AdsCopyProvider';
import type { ReactNode } from 'react';
import { IconAd2, IconCopy, IconExternalLink, IconLayoutList, IconSpeakerphone } from '@tabler/icons-react';
import { Badge } from '@/components/Badge';
import { DataTable } from '@/components/DataTable';
import { Sparkline } from '@/components/charts';
import { useToast } from '@/components/Toast';
import '../ads.css';

export type HierarchyLevel = 'campaign' | 'adset' | 'ad';
export type HierarchyRow = {
  key: string; id: string; name: string; level: HierarchyLevel; currency: string | null;
  spend: number; impressions: number; clicks: number; ctr: number | null; cpc: number | null;
  /** Days with stored delivery rows. */
  days: number;
  /** Daily spend, oldest first; null is a day without a stored row. */
  spendSeries: Array<number | null>;
};

const LEVEL_ICON = { campaign: <IconSpeakerphone size={16} />, adset: <IconLayoutList size={16} />, ad: <IconAd2 size={16} /> } as const;

/**
 * Campaign / ad set / ad results as one table: stored delivery badge, spend trend, key measures and a
 * row menu. Status here is what the stored daily rows show; the live configured status stays in the
 * object manager, which fetches it when opened. `actions` and `details` are server-rendered slots keyed by row.
 */
export function HierarchyTable({ caption, rows, locale, actions, details, objectsHref }: {
  caption: string; rows: HierarchyRow[]; locale: 'en' | 'fr';
  actions?: Record<string, ReactNode>; details?: Record<string, ReactNode>;
  /** Base path of the objects list; the row menu opens it filtered to the object. */
  objectsHref?: string;
}) {
  const t = useAdsText(locale);
  const toast = useToast();
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const money = (value: number | null, currency: string | null) => value === null ? '—'
    : currency ? new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value) : number.format(value);
  const levelWord = { campaign: t('text156'), adset: t('text157'), ad: t('text158') };
  const showActions = Boolean(actions && Object.keys(actions).length), showDetails = Boolean(details && Object.keys(details).length);

  async function copyId(row: HierarchyRow) {
    try { await navigator.clipboard.writeText(row.id); toast.notify({ title: t('text159'), tone: 'success' }); }
    catch { toast.failed(t('text160'), () => void copyId(row), t('text161')); }
  }

  return <DataTable caption={caption} rows={rows} rowKey={row => row.key} density="compact"
    emptyMessage={t('text162')}
    rowActionsLabel={row => t('text163', { value0: row.name })}
    rowActions={row => [
      { key: 'copy', label: t('text164'), icon: <IconCopy size={16} />, onSelect: () => void copyId(row) },
      ...(objectsHref ? [{ key: 'open', label: t('text165'), icon: <IconExternalLink size={16} />,
        onSelect: () => window.location.assign(`${objectsHref}${objectsHref.includes('?') ? '&' : '?'}${new URLSearchParams({ level: row.level, q: row.name })}`) }] : []),
    ]}
    columns={[
      { key: 'name', label: t('text066'), hideCardLabel: true, render: row => <span className="ads-hierarchy__name">
        <span className="ui-mod-chip" data-module="ads" aria-hidden="true">{LEVEL_ICON[row.level]}</span>
        <span><strong>{row.name}</strong><small className="ads-object-id">{levelWord[row.level]} {t('text166')}{row.id}</small></span>
      </span> },
      { key: 'delivery', label: t('text167'), render: row => row.spend > 0 || row.impressions > 0
        ? <Badge tone="success">{t('text168')} {t('text166')}{row.days} {row.days === 1 ? t('text169') : t('text170')}</Badge>
        : <Badge tone="neutral">{t('text171')}</Badge> },
      { key: 'spend', label: t('text019'), align: 'end', render: row => <span className="ads-hierarchy__spend">
        <span>{money(row.spend, row.currency)}</span>
        {row.spendSeries.length > 1 && <Sparkline label={t('text172', { value0: row.name })} values={row.spendSeries} table={false} area />}
      </span> },
      { key: 'impressions', label: t('text020'), align: 'end', render: row => number.format(row.impressions) },
      { key: 'clicks', label: t('text022'), align: 'end', render: row => number.format(row.clicks) },
      { key: 'ctr', label: t('text025'), align: 'end', render: row => row.ctr === null ? '—' : `${number.format(row.ctr)}%` },
      { key: 'cpc', label: t('text023'), align: 'end', render: row => money(row.cpc, row.currency) },
      ...(showActions ? [{ key: 'manage', label: t('text173'), render: (row: HierarchyRow) => actions?.[row.key] ?? null }] : []),
      ...(showDetails ? [{ key: 'details', label: t('text174'), render: (row: HierarchyRow) => details?.[row.key] ?? null }] : []),
    ]} />;
}
