import type { ModuleManifest } from '../types';

export const adsManifest = {
  id: 'ads',
  area: 'insights',
  health: { configuration: true, jobHistory: true, pendingQueues: [] },
  jobs: [],
  rootSettingsPrefixes: ['ads.'],
  rootSettingKeys: [],
  title: 'Ads',
  href: '/insights/ads',
  /** Design v2 B5: Ads reporting and management live under Insights; Compare is one tool with a channels/ad accounts switch. */
  redirects: [
    { from: '/ads', to: '/insights/ads' },
    { from: '/ads/campaigns', to: '/insights/ads/campaigns' },
    { from: '/ads/objects', to: '/insights/ads/manage' },
    { from: '/ads/compare', to: '/insights/compare/ads' },
  ],
  pages: [
    { id: 'ads/overview', title: 'Ads', href: '/insights/ads', tabOrder: 60, description: 'See paid performance across accounts.' },
    { id: 'ads/compare', title: 'Compare ad accounts', href: '/insights/compare/ads', navigation: false, description: 'Compare account and object results with honest coverage and currency totals.' },
    { id: 'ads/objects', title: 'Manage', href: '/insights/ads/manage', navigation: false, description: 'Browse campaigns, ad sets and ads with stored results and freshness.' },
    { id: 'ads/campaigns', title: 'Campaigns', href: '/insights/ads/campaigns', navigation: false, description: 'Manage campaign results.' },
  ],
} as const satisfies ModuleManifest;
