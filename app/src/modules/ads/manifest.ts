import type { ModuleManifest } from '../types';

export const adsManifest = {
  id: 'ads',
  area: 'ads',
  health: { configuration: true, jobHistory: true, pendingQueues: [] },
  jobs: [],
  rootSettingsPrefixes: ['ads.'],
  rootSettingKeys: [],
  title: 'Ads',
  href: '/ads',
  /** Design v2: Ads insights and management live in their own Ads area; the old Insights addresses redirect permanently. */
  redirects: [
    { from: '/insights/ads', to: '/ads' },
    { from: '/insights/ads/campaigns', to: '/ads/campaigns' },
    { from: '/insights/ads/manage', to: '/ads/manage' },
    { from: '/insights/compare/ads', to: '/ads/compare' },
    { from: '/ads/objects', to: '/ads/manage' },
  ],
  /** `tabOrder` fixes the Ads area tabs: Overview, Manage, Compare (2026-11-12: Campaigns and Analysis folded into Manage; their addresses forward there, and /ads/campaigns stays for the boost flow). */
  pages: [
    { id: 'ads/overview', title: 'Overview', href: '/ads', tabOrder: 10, description: 'See paid performance across accounts.' },
    { id: 'ads/campaigns', title: 'Campaigns', href: '/ads/campaigns', navigation: false, palette: false, description: 'Manage campaign results.' },
    { id: 'ads/objects', title: 'Manage', href: '/ads/manage', tabOrder: 30, description: 'Browse campaigns, ad sets and ads with stored results and freshness.' },
    { id: 'ads/compare', title: 'Compare', href: '/ads/compare', tabOrder: 50, description: 'Compare account and object results with honest coverage and currency totals.' },
  ],
} as const satisfies ModuleManifest;
