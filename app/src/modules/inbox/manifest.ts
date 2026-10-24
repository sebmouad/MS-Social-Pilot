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
  /** Design v2 B4: moderation rules became the Rules tab of the Inbox. */
  redirects: [{ from: '/inbox/moderation', to: '/inbox/rules' }],
  pages: [
    { id: 'inbox/conversations', title: 'Inbox', href: '/inbox', description: 'Follow conversations across channels.' },
  ],
} as const satisfies ModuleManifest;
