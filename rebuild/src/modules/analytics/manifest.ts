import type { ModuleManifest } from '../types';

export const analyticsManifest = {
  id: 'analytics',
  title: 'Analytics',
  href: '/analytics',
  pages: [
    { id: 'analytics/overview', title: 'Analytics', href: '/analytics', description: 'Explore every available metric in one place.' },
  ],
} as const satisfies ModuleManifest;
