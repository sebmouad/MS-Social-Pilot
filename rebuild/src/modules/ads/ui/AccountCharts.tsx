'use client';
import { useAdsText } from '@/modules/ads/ui/AdsCopyProvider';
import { MetricCard } from '@/components/MetricCard';
import { TimeSeriesChart, FunnelChart } from '@/components/charts';
import { IconCoin, IconEye, IconClick, IconPercentage } from '@tabler/icons-react';
import type { AdsSummary } from '@/modules/ads/server/summary';

/** Account currencies remain separate; action types cannot be summed as results. */
export function AccountCharts({ row, locale = 'en' }: { row: AdsSummary; locale?: 'en' | 'fr' }) {
  const t = useAdsText(locale);
  const number = new Intl.NumberFormat(locale);
  const money = (value: number | null) => value === null ? '—' : row.currency
    ? new Intl.NumberFormat(locale, { style: 'currency', currency: row.currency }).format(value) : number.format(value);
  const days = [...row.dailyMetrics].sort((a, b) => a.date.getTime() - b.date.getTime());
  const spend = t('text019');
  return <section aria-label={t('text143')}>
    <div className="metric-grid">
      <MetricCard module="ads" icon={<IconCoin />} label={spend} value={money(row.spend)} hint={row.currency ?? t('text144')} sparkline={days.map(day => day.spend)} />
      <MetricCard module="ads" icon={<IconEye />} label={t('text020')} value={number.format(row.impressions)} sparkline={days.map(day => day.impressions)} />
      <MetricCard module="ads" icon={<IconPercentage />} label={t('text025')} value={row.ctr === null ? '—' : new Intl.NumberFormat(locale, { style: 'percent' }).format(row.ctr / 100)} />
      <MetricCard module="ads" icon={<IconClick />} label={t('text023')} value={money(row.cpc)} />
      <MetricCard module="ads" icon={<IconClick />} label={t('text145')} value="—" unavailable={t('text146')} />
    </div>
    <TimeSeriesChart locale={locale} label={`${row.accountName} · ${spend}`} format={row.currency ? { style: 'currency', currency: row.currency } : undefined}
      series={[{ id: 'spend', name: spend, area: true, points: days.map(day => ({ t: day.date.toISOString().slice(0, 10), v: day.spend })) }]} />
    <FunnelChart locale={locale} label={t('text147')} stages={[
      { name: t('text020'), value: row.impressions }, { name: t('text022'), value: row.clicks }, { name: t('text145'), value: null },
    ]} />
    <p className="small-note">{t('text148')}</p>
  </section>;
}
