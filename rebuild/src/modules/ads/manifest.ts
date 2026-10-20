import type { ModuleManifest } from '../types';

export const adsManifest = {
  id: 'ads',
  health: { configuration: true, jobHistory: true, pendingQueues: [] },
  jobs: [],
  rootSettingsPrefixes: ['ads.'],
  rootSettingKeys: [],
  title: 'Ads',
  href: '/ads',
  pages: [
    { id: 'ads/overview', title: 'Ad accounts', href: '/ads', description: 'See paid performance across accounts.' },
    { id: 'ads/compare', title: 'Compare', href: '/ads/compare', description: 'Compare account and object results with honest coverage and currency totals.' },
    { id: 'ads/objects', title: 'Objects', href: '/ads/objects', description: 'Browse campaigns, ad sets and ads with stored results and freshness.' },
    { id: 'ads/campaigns', title: 'Campaigns', href: '/ads/campaigns', description: 'Manage campaign results.' },
  ],
} as const satisfies ModuleManifest;
