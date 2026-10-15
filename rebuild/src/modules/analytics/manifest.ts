import type { ModuleManifest } from '../types';

export const analyticsManifest = {
  id: 'analytics',
  title: 'Analytics',
  href: '/analytics',
  pages: [
    { id: 'analytics/overview', title: 'Analytics', href: '/analytics', description: 'Explore every available metric in one place.' },
    { id: 'analytics/reports', title: 'CSV export', href: '/reports', navigation: false, description: 'Export the selected Analytics range and channels.' },
  ],
} as const satisfies ModuleManifest;
