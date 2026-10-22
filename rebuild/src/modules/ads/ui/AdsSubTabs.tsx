import type { AdsInsightsCopy } from './ads-insights';
import { adsQuery } from './query';
import type { AdsFilters } from '@/modules/ads/server/queries';

export type AdsSection = 'accounts' | 'campaigns' | 'manage' | 'analysis';
const PATH: Record<AdsSection, string> = { accounts: '/insights/ads', campaigns: '/insights/ads/campaigns', manage: '/insights/ads/manage', analysis: '/insights/ads/analysis' };

/**
 * Sub-tabs of Insights › Ads (design v2 S12): Accounts · Campaigns · Manage · Analysis. A section the member cannot
 * use is absent. The period and ad account in the address travel with the member from tab to tab.
 */
export function AdsSubTabs({ current, copy, available, filters }: { current: AdsSection; copy: AdsInsightsCopy; available: readonly AdsSection[]; filters?: AdsFilters }) {
  const label: Record<AdsSection, string> = { accounts: copy.tabAccounts, campaigns: copy.tabCampaigns, manage: copy.tabManage, analysis: copy.tabAnalysis };
  const sections = (['accounts', 'campaigns', 'manage', 'analysis'] as const).filter(section => section === 'accounts' || available.includes(section));
  if (sections.length < 2) return null;
  return <nav aria-label={copy.tabs}><ul className="insights-subtabs">
    {sections.map(section => <li key={section}><a href={section === 'analysis' || !filters ? PATH[section] : adsQuery(filters, PATH[section])} aria-current={section === current ? 'page' : undefined}>{label[section]}</a></li>)}
  </ul></nav>;
}
