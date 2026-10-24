'use client';
import { TrendChart, type TimeSeries } from '@/components/charts';
import local from './screen.module.css';
import type { readAdObjects } from './service';

type AccountDaily = Awaited<ReturnType<typeof readAdObjects>>['accountDaily'];

const spendOf = (account: AccountDaily[number]): TimeSeries => ({ id: account.accountId, name: account.accountName,
  points: account.daily.map(day => ({ t: day.date, v: day.spend })) });
const impressionsOf = (account: AccountDaily[number]): TimeSeries => ({ id: account.accountId, name: account.accountName,
  points: account.daily.map(day => ({ t: day.date, v: day.impressions })) });

/**
 * Ads analysis hero: the filtered selection as daily trends. One stacked spend panel per currency
 * (money is never mixed), one impressions panel for every covered account. Server-resolved labels;
 * nothing renders when the selection has no stored days.
 */
export function ObjectsTrendCharts({ accounts, locale, labels }: {
  accounts: AccountDaily; locale: 'en' | 'fr';
  labels: { trend: string; spend: string; impressions: string; unknownCurrency: string };
}) {
  const withData = accounts.filter(account => account.daily.length > 0);
  if (!withData.length) return null;
  const groups = new Map<string | null, AccountDaily[number][]>();
  for (const account of withData) groups.set(account.currency, [...(groups.get(account.currency) ?? []), account]);
  const ordered = [...groups].sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
  return <section aria-label={labels.trend} className={local.trend}>
    {ordered.map(([currency, list]) => <div key={currency ?? ''}>
      <h3>{labels.spend} · {currency ?? labels.unknownCurrency}</h3>
      <TrendChart locale={locale} height={240} stacked label={`${labels.spend} · ${currency ?? labels.unknownCurrency}`}
        format={currency ? { style: 'currency', currency } : undefined} series={list.map(spendOf)} />
    </div>)}
    <div>
      <h3>{labels.impressions}</h3>
      <TrendChart locale={locale} height={240} label={labels.impressions} series={withData.map(impressionsOf)} />
    </div>
  </section>;
}
