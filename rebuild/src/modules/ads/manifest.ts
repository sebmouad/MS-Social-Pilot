import type { ModuleManifest } from '../types';

export const adsManifest = {
  id: 'ads',
  title: 'Ads',
  href: '/ads',
  pages: [
    { id: 'ads/overview', title: 'Ad accounts', href: '/ads', description: 'See paid performance across accounts.' },
    { id: 'ads/campaigns', title: 'Campaigns', href: '/ads/campaigns', description: 'Manage campaign results.' },
  ],
} as const satisfies ModuleManifest;
