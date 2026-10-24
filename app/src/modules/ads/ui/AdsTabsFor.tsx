import type { AdsFilters } from '@/modules/ads/server/queries';
import { loadAdsInsightsCopy } from './ads-insights-server';
import { AdsHeader } from './AdsHeader';
import type { ReactNode } from 'react';
import type { AdsReportPolicy } from '@/modules/ads/report-policy';

/**
 * The full Ads header (title, ⓘ, period, ad-account filter) for a screen other than Accounts,
 * so every Ads screen shares one header instead of a stacked filter form.
 */
export async function adsHeaderFor(props: {
  title: string; locale: 'en' | 'fr'; policy: AdsReportPolicy; filters: AdsFilters; accounts: Array<{ id: string; name: string }>;
  periodLabel: string; customLabel: string; count?: ReactNode; actions?: ReactNode;
}) {
  const { copy } = await loadAdsInsightsCopy();
  return <AdsHeader {...props} copy={copy} />;
}
