import type { ModuleManifest } from '../types';

export const analyticsManifest = {
  id: 'analytics',
  title: 'Analytics',
  href: '/analytics',
  pages: [
    { id: 'analytics/overview', title: 'Analytics', href: '/analytics', description: 'Explore every available metric in one place.' },
    { id: 'analytics/reports', title: 'Reports', href: '/analytics/reports', description: 'Save and share what matters.' },
  ],
} as const satisfies ModuleManifest;
