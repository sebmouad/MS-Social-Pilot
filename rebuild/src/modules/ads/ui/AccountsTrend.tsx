'use client';
import { useAdsText } from '@/modules/ads/ui/AdsCopyProvider';
import { TrendChart } from '@/components/charts';
import type { TimeSeries } from '@/components/charts';

export type AccountTrendDay = { date: string; spend: number | null; impressions: number | null };
export type AccountTrend = { id: string; name: string; currency: string | null; daily: AccountTrendDay[] };

/** Readable charts cap the plotted accounts; the table below always lists every account. */
export const TREND_ACCOUNT_MAX = 12;

/** Spend is stacked per currency only; impressions are unitless so all accounts share one panel. */
export function groupAccountsByCurrency(accounts: readonly AccountTrend[]): Array<{ currency: string | null; accounts: AccountTrend[] }> {
  const groups = new Map<string | null, AccountTrend[]>();
  for (const account of [...accounts].sort((a, b) => a.name.localeCompare(b.name))) {
    const group = groups.get(account.currency) ?? [];
    group.push(account);
    groups.set(account.currency, group);
  }
  return [...groups].sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b))).map(([currency, list]) => ({ currency, accounts: list }));
}

const total = (account: AccountTrend, pick: (day: AccountTrendDay) => number | null) =>
  account.daily.reduce((sum, day) => sum + (pick(day) ?? 0), 0);

/**
 * Ads › Accounts hero: portfolio trend above the table. One stacked spend panel per currency (money
 * is never mixed), one impressions panel for every account. Top accounts by spend are plotted when
 * there are more than fit; the note says so explicitly.
 */
export function AccountsTrendCharts({ accounts, locale = 'en' }: { accounts: readonly AccountTrend[]; locale?: 'en' | 'fr' }) {
  const t = useAdsText(locale);
  const withData = accounts.filter(account => account.daily.length > 0);
  if (!withData.length) return null;
  const ranked = [...withData].sort((a, b) => total(b, day => day.spend) - total(a, day => day.spend));
  const plotted = ranked.slice(0, TREND_ACCOUNT_MAX);
  const omitted = ranked.length - plotted.length;
  const spend = (account: AccountTrend): TimeSeries => ({ id: account.id, name: account.name,
    points: account.daily.map(day => ({ t: day.date, v: day.spend })) });
  const impressions = (account: AccountTrend): TimeSeries => ({ id: account.id, name: account.name,
    points: account.daily.map(day => ({ t: day.date, v: day.impressions })) });
  return <section aria-label={t('text273')} className="ads-campaign-charts">
    <div className="ads-campaign-charts__grid">
      {groupAccountsByCurrency(plotted).map(group => <div key={group.currency ?? ''} className="ads-campaign-charts__panel">
        <h3>{t('text274', { value0: group.currency ?? t('text144') })}</h3>
        <TrendChart locale={locale} height={240} stacked label={`${t('text274', { value0: group.currency ?? t('text144') })}`}
          format={group.currency ? { style: 'currency', currency: group.currency } : undefined}
          series={group.accounts.map(spend)} />
      </div>)}
      <div className="ads-campaign-charts__panel">
        <h3>{t('text275')}</h3>
        <TrendChart locale={locale} height={240} label={t('text275')} series={plotted.map(impressions)} />
      </div>
    </div>
    {omitted > 0 && <p className="small-note">{t('text276', { value0: plotted.length, value1: ranked.length })}</p>}
  </section>;
}
