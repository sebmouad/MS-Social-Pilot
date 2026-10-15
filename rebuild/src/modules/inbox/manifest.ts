import type { ModuleManifest } from '../types';

export const inboxManifest = {
  id: 'inbox',
  title: 'Inbox',
  href: '/inbox',
  pages: [
    { id: 'inbox/conversations', title: 'Inbox', href: '/inbox', description: 'Follow conversations across channels.' },
  ],
} as const satisfies ModuleManifest;
