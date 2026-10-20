import { MetricCard } from '@/components/MetricCard';
import { TimeSeriesChart, FunnelChart } from '@/components/charts';
import { IconCoin, IconEye, IconClick, IconPercentage } from '@tabler/icons-react';
import type { AdsSummary } from '@/modules/ads/server/summary';

/** Account currencies remain separate; action types cannot be summed as results. */
export function AccountCharts({ row, locale = 'en' }: { row: AdsSummary; locale?: 'en' | 'fr' }) {
  const t = (en: string, french: string) => locale === 'fr' ? french : en;
  const number = new Intl.NumberFormat(locale);
  const money = (value: number | null) => value === null ? '—' : row.currency
    ? new Intl.NumberFormat(locale, { style: 'currency', currency: row.currency }).format(value) : number.format(value);
  const days = [...row.dailyMetrics].sort((a, b) => a.date.getTime() - b.date.getTime());
  const spend = t('Spend', 'Dépenses');
  return <section aria-label={t('Account performance charts', 'Graphiques de performance du compte')}>
    <div className="metric-grid">
      <MetricCard module="ads" icon={<IconCoin />} label={spend} value={money(row.spend)} hint={row.currency ?? t('Currency unavailable', 'Devise indisponible')} sparkline={days.map(day => day.spend)} />
      <MetricCard module="ads" icon={<IconEye />} label="Impressions" value={number.format(row.impressions)} sparkline={days.map(day => day.impressions)} />
      <MetricCard module="ads" icon={<IconPercentage />} label="CTR" value={row.ctr === null ? '—' : new Intl.NumberFormat(locale, { style: 'percent' }).format(row.ctr / 100)} />
      <MetricCard module="ads" icon={<IconClick />} label="CPC" value={money(row.cpc)} />
      <MetricCard module="ads" icon={<IconClick />} label={t('Results', 'Résultats')} value="—" unavailable={t('No comparable results measure is available.', 'Aucune mesure de résultats comparable n’est disponible.')} />
    </div>
    <TimeSeriesChart locale={locale} label={`${row.accountName} · ${spend}`} format={row.currency ? { style: 'currency', currency: row.currency } : undefined}
      series={[{ id: 'spend', name: spend, area: true, points: days.map(day => ({ t: day.date.toISOString().slice(0, 10), v: day.spend })) }]} />
    <FunnelChart locale={locale} label={t('Impressions to clicks', 'Des impressions aux clics')} stages={[
      { name: 'Impressions', value: row.impressions }, { name: t('Clicks', 'Clics'), value: row.clicks }, { name: t('Results', 'Résultats'), value: null },
    ]} />
    <p className="small-note">{t('Results are unavailable as a comparable measure. Individual action types remain in the details below.', 'Les résultats ne sont pas disponibles sous forme de mesure comparable. Chaque type d’action reste visible dans les détails ci-dessous.')}</p>
  </section>;
}
