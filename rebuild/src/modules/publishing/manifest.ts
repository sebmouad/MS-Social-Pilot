import type { ModuleManifest } from '../types';

export const publishingManifest = {
  id: 'publishing',
  jobs: [
    { name: 'posts', label: 'Post delivery and status', configKey: 'sync.posts.schedule' },
    { name: 'mediaCleanup', label: 'Orphan image cleanup', configKey: 'storage.orphanMediaCleanupSchedule' },
    { name: 'publishingRecycle', label: 'Post recycling', configKey: 'publishing.automation.recycleSchedule' },
    { name: 'publishingMix', label: 'Content mix scheduling', configKey: 'publishing.automation.mixSchedule' },
  ],
  rootSettingsPrefixes: ['publishing.', 'media.inspect', 'media.ffprobe'],
  rootSettingKeys: ['sync.posts.schedule', 'storage.orphanMediaRetentionDays', 'storage.orphanMediaBatchLimit', 'storage.mediaLibraryBatchLimit', 'storage.orphanMediaCleanupSchedule', 'publishing.automation.recycleSchedule', 'publishing.automation.mixSchedule', 'publishing.automation.recycleCursor', 'publishing.automation.mixCursor'],
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
    { id: 'publishing/collaboration', title: 'Organize', href: '/publishing/collaboration', description: 'Label posts, manage custom fields and collaborate with your team.' },
    { id: 'publishing/labels', title: 'Labels', href: '/publishing/labels', description: 'Organize workspace content with shared labels.' },
    { id: 'publishing/templates', title: 'Templates', href: '/publishing/templates', description: 'Create and reuse workspace post templates.' },
  ],
} as const satisfies ModuleManifest;
