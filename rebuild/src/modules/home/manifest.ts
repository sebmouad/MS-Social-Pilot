import type { ModuleManifest } from '../types';

export const homeManifest = {
  id: 'home',
  health: { configuration: true, jobHistory: true, pendingQueues: [] },
  jobs: [],
  rootSettingsPrefixes: ['home.'],
  rootSettingKeys: [],
  title: 'Home',
  href: '/home',
  pages: [
    { id: 'home/overview', title: 'Overview', href: '/home', description: 'Your work at a glance.' },
  ],
} as const satisfies ModuleManifest;
