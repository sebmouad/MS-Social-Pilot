import { IconClick, IconCoin, IconEye, IconPercentage } from '@tabler/icons-react';
import { FunnelChart, TimeSeriesChart } from '@/components/charts';
import { MetricCard } from '@/components/MetricCard';
import type { AdsSummary } from '@/modules/ads/server/summary';

const day = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Account-level view of the campaign rows on the page: KPI cards, spend per campaign over time and the
 * impressions-to-clicks funnel. Each ad account keeps its own currency, so the caller renders one per
 * account. Campaign rows only: ad sets and ads repeat the same delivery and would double count.
 * Results are not summed across action types, so the funnel's last stage stays unknown.
 */
export function CampaignCharts({ accountName, rows, locale }: { accountName: string; rows: readonly AdsSummary[]; locale: 'en' | 'fr' }) {
  const t = (en: string, french: string) => locale === 'fr' ? french : en;
  const campaigns = rows.filter(row => row.level === 'campaign');
  if (!campaigns.length) return null;
  const currency = campaigns[0]!.currency;
  if (campaigns.some(row => row.currency !== currency)) return null; // Never mix currencies in one chart.
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const money = (value: number) => currency ? new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value) : number.format(value);
  const sum = (pick: (row: AdsSummary) => number) => campaigns.reduce((total, row) => total + pick(row), 0);
  const spend = sum(row => row.spend), impressions = sum(row => row.impressions), clicks = sum(row => row.clicks);
  const ctr = impressions > 0 ? clicks / impressions : null;
  const daily = (select: (entry: AdsSummary['dailyMetrics'][number]) => number) => {
    const byDay = new Map<string, number>();
    for (const row of campaigns) for (const entry of row.dailyMetrics) byDay.set(day(entry.date), (byDay.get(day(entry.date)) ?? 0) + select(entry));
    return [...byDay].sort(([a], [b]) => a.localeCompare(b));
  };
  const spendDays = daily(entry => entry.spend), impressionDays = daily(entry => entry.impressions), clickDays = daily(entry => entry.clicks);

  return <section className="ads-campaign-charts" aria-label={t(`Campaign performance for ${accountName}`, `Performance des campagnes pour ${accountName}`)}>
    <div className="metric-grid">
      <MetricCard module="ads" icon={<IconCoin />} label={t('Spend', 'Dépenses')} value={money(spend)} hint={currency ?? t('Currency unavailable', 'Devise indisponible')} sparkline={spendDays.map(([, value]) => value)} />
      <MetricCard module="ads" icon={<IconEye />} label="Impressions" value={number.format(impressions)} sparkline={impressionDays.map(([, value]) => value)} />
      <MetricCard module="ads" icon={<IconClick />} label={t('Clicks', 'Clics')} value={number.format(clicks)} sparkline={clickDays.map(([, value]) => value)} />
      <MetricCard module="ads" icon={<IconPercentage />} label="CTR" value={ctr === null ? '—' : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(ctr)}
        unavailable={ctr === null ? t('No impressions stored.', 'Aucune impression enregistrée.') : undefined} />
    </div>
    <div className="ads-campaign-charts__grid">
      <div>
        <h3>{t('Spend per campaign', 'Dépenses par campagne')}</h3>
        <TimeSeriesChart locale={locale} label={t(`Daily spend per campaign, ${accountName}`, `Dépenses quotidiennes par campagne, ${accountName}`)}
          format={currency ? { style: 'currency', currency } : undefined}
          series={campaigns.filter(row => row.dailyMetrics.length).map(row => ({ id: row.id, name: row.name,
            points: [...row.dailyMetrics].sort((a, b) => a.date.getTime() - b.date.getTime()).map(entry => ({ t: day(entry.date), v: entry.spend })) }))} />
      </div>
      <div>
        <h3>{t('From views to results', 'Des vues aux résultats')}</h3>
        <FunnelChart locale={locale} label={t(`Impressions to clicks, ${accountName}`, `Des impressions aux clics, ${accountName}`)} stages={[
          { name: 'Impressions', value: impressions }, { name: t('Clicks', 'Clics'), value: clicks }, { name: t('Results', 'Résultats'), value: null },
        ]} />
        <p className="small-note">{t('Results differ by objective, so they are not added together. Each action type stays in the stored details.', 'Les résultats dépendent de l’objectif et ne sont donc pas additionnés. Chaque type d’action reste dans les détails enregistrés.')}</p>
      </div>
    </div>
  </section>;
}
