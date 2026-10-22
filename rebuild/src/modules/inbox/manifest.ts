import type { ModuleManifest } from '../types';

export const inboxManifest = {
  id: 'inbox',
  area: 'inbox',
  health: { configuration: true, jobHistory: true, pendingQueues: [] },
  jobs: [{ name: 'inbox', label: 'Inbox synchronization', configKey: 'sync.inbox.schedule' }],
  rootSettingsPrefixes: ['inbox.'],
  rootSettingKeys: ['sync.inbox.schedule'],
  title: 'Inbox',
  href: '/inbox',
  pages: [
    { id: 'inbox/conversations', title: 'Inbox', href: '/inbox', description: 'Follow conversations across channels.' },
  ],
} as const satisfies ModuleManifest;
