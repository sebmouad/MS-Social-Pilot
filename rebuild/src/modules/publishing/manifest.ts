import type { ModuleManifest } from '../types';

export const publishingManifest = {
  id: 'publishing',
  jobs: [{ name: 'posts', label: 'Post delivery and status', configKey: 'sync.posts.schedule' }, { name: 'mediaCleanup', label: 'Orphan image cleanup', configKey: 'storage.orphanMediaCleanupSchedule' }],
  rootSettingsPrefixes: ['publishing.'],
  rootSettingKeys: ['sync.posts.schedule', 'storage.orphanMediaRetentionDays', 'storage.orphanMediaBatchLimit', 'storage.mediaLibraryBatchLimit', 'storage.orphanMediaCleanupSchedule'],
  title: 'Publishing',
  mobileTitle: 'Publish',
  href: '/publishing/posts',
  primaryAction: { href: '/publishing/compose', label: 'New post', featureId: 'publishing/posts' },
  pages: [
    { id: 'publishing/posts', title: 'Posts', href: '/publishing/posts', description: 'Create and manage content across your channels.' },
    { id: 'publishing/calendar', title: 'Calendar', href: '/publishing/calendar', description: 'See what is planned and published.' },
    { id: 'publishing/queue', title: 'Queue', href: '/publishing/queue', description: 'Review work waiting to publish.' },
    { id: 'publishing/approvals', title: 'Approvals', href: '/publishing/approvals', description: 'Review posts before they go live.' },
    { id: 'publishing/media', title: 'Image library', href: '/publishing/media', description: 'Browse and manage images stored in this workspace.' },
  ],
} as const satisfies ModuleManifest;
