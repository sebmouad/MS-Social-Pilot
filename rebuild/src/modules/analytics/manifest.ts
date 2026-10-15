import type { ModuleManifest } from '../types';

export const analyticsManifest = {
  id: 'analytics',
  title: 'Analytics',
  href: '/analytics',
  pages: [
    { id: 'analytics/overview', title: 'Analytics', href: '/analytics', description: 'Explore every available metric in one place.' },
    { id: 'analytics/reports', title: 'Reports', href: '/reports', description: 'Review a date and channel scoped report, and export its data.' },
  ],
} as const satisfies ModuleManifest;
