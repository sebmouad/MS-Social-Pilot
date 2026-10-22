import type { ReactNode } from 'react';
import { InfoTip } from '@/components';
import { PageHeader } from '@/components/PageHeader';
import { InsightsFilterRow } from '@/modules/analytics/ui/insights/InsightsFilterRow';
import type { AdsReportPolicy } from '@/modules/ads/report-policy';
import type { AdsFilters } from '@/modules/ads/server/queries';
import { AdsAccountField } from './AdsAccountField';
import type { AdsInsightsCopy } from './ads-insights';
import { AdsSubTabs, type AdsSection } from './AdsSubTabs';

const DAY = 86_400_000;
const day = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Header of every Insights › Ads screen (design v2 S12): title with its ⓘ, the Accounts/Campaigns/Manage/Analysis
 * sub-tabs and one filter row: the report period (Root presets and a typed range) and the Filter button with the
 * ad-account switcher. The channel scope of the sidebar does not apply here; ad accounts use `account=`.
 */
export function AdsHeader({ title, copy, locale, policy, filters, accounts, current, available, actions, count, periodLabel, customLabel }: {
  title: string;
  copy: AdsInsightsCopy;
  locale: 'en' | 'fr';
  policy: AdsReportPolicy;
  filters: AdsFilters;
  accounts: Array<{ id: string; name: string }>;
  current: AdsSection;
  available: readonly AdsSection[];
  actions?: ReactNode;
  count?: ReactNode;
  periodLabel: string;
  customLabel: string;
}) {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const presets = policy.presets.map(item => ({ id: item.id, label: item.label, start: day(new Date(end.getTime() - (item.days - 1) * DAY)), end: day(end) }));
  const period = { preset: filters.period, start: day(filters.since), end: day(new Date(filters.until.getTime() - DAY)) };
  return <>
    <PageHeader module="ads" title={title} count={count} info={<InfoTip name={title} blocks={[{ text: copy.info }, { text: copy.totalsNote }]} />} actions={actions}
      filters={<InsightsFilterRow presets={presets} period={period} compare={false} showCompare={false} names={{ from: 'since', to: 'until' }} customPeriod="custom" activeCount={filters.accountId ? 1 : 0}
        labels={{ period: periodLabel, compare: '', active: '', remove: '', reset: '', filters: copy.accountFilter, customSummary: customLabel }}>
        <AdsAccountField accounts={accounts} label={copy.accountFilter} allLabel={copy.accountAll} />
      </InsightsFilterRow>} />
    <AdsSubTabs current={current} copy={copy} available={available} filters={filters} />
  </>;
}
