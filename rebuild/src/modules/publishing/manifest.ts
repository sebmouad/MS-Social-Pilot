import type { ModuleManifest } from '../types';

export const publishingManifest = {
  id: 'publishing',
  title: 'Publishing',
  mobileTitle: 'Publish',
  href: '/publishing/posts',
  pages: [
    { id: 'publishing/posts', title: 'Posts', href: '/publishing/posts', description: 'Create and manage content across your channels.' },
    { id: 'publishing/compose', title: 'New post', href: '/publishing/compose', description: 'Write a post, choose channels, and publish, schedule, or save it.', navigation: false },
    { id: 'publishing/calendar', title: 'Calendar', href: '/publishing/calendar', description: 'See what is planned and published.' },
    { id: 'publishing/queue', title: 'Queue', href: '/publishing/queue', description: 'Review work waiting to publish.' },
    { id: 'publishing/approvals', title: 'Approvals', href: '/publishing/approvals', description: 'Review posts before they go live.' },
    { id: 'publishing/import', title: 'Import', href: '/publishing/import', description: 'Add many draft posts at once from a CSV file.' },
    { id: 'publishing/media', title: 'Image library', href: '/publishing/media', description: 'Browse and manage images stored in this workspace.' },
  ],
} as const satisfies ModuleManifest;
