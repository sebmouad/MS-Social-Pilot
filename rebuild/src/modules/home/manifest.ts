import type { ModuleManifest } from '../types';

export const homeManifest = {
  id: 'home',
  title: 'Home',
  href: '/home',
  pages: [
    { id: 'home/overview', title: 'Overview', href: '/home', description: 'Your work at a glance.' },
  ],
} as const satisfies ModuleManifest;
