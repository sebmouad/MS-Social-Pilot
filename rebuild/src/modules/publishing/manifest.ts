import type { ModuleManifest } from '../types';
import { MEDIA_PAGES, MEDIA_ROOT_KEYS } from '../media/manifest';
import { FEEDS_JOBS, FEEDS_PAGES, FEEDS_ROOT_KEYS } from '../feeds/manifest';
import { ASYNC_POST_EXPORT_JOBS } from './server/export/config';
import { CAPTION_TESTS_JOBS } from '../caption-tests/config';
import { AI_VIDEO_JOBS } from '../ai/content-tools/config';
import { CALENDAR_EXTRAS_JOBS } from '../calendar-extras/manifest';

export const publishingManifest = {
  id: 'publishing',
  area: 'content',
  health: { configuration: true, jobHistory: true, pendingQueues: ['scheduledPosts', 'publicationAttempts'] },
  jobs: [
    { name: 'posts', label: 'Post delivery and status', configKey: 'sync.posts.schedule' },
    { name: 'mediaCleanup', label: 'Orphan image cleanup', configKey: 'storage.orphanMediaCleanupSchedule' },
    { name: 'publishingRecycle', label: 'Post recycling', configKey: 'publishing.automation.recycleSchedule' },
    { name: 'publishingMix', label: 'Content mix scheduling', configKey: 'publishing.automation.mixSchedule' },
    { name: 'bestTimes', label: 'Best-time queue application', configKey: 'publishing.bestTimeApplySchedule' },
    ...FEEDS_JOBS,
    ...ASYNC_POST_EXPORT_JOBS,
    ...CALENDAR_EXTRAS_JOBS,
    ...CAPTION_TESTS_JOBS,
    ...AI_VIDEO_JOBS,
  ],
  rootSettingsPrefixes: ['publishing.', 'calendarExtras.', 'media.inspect', 'media.ffprobe', 'ai.'],
  rootSettingKeys: ['sync.posts.schedule', 'storage.orphanMediaRetentionDays', 'storage.orphanMediaBatchLimit', 'storage.mediaLibraryBatchLimit', 'storage.orphanMediaCleanupSchedule', 'publishing.automation.recycleSchedule', 'publishing.automation.mixSchedule', 'publishing.automation.recycleCursor', 'publishing.automation.mixCursor', 'publishing.bestTimeApplySchedule', ...MEDIA_ROOT_KEYS, ...FEEDS_ROOT_KEYS],
  title: 'Publishing',
  mobileTitle: 'Publish',
  href: '/publishing/posts',
  primaryAction: { href: '/publishing/compose', label: 'New post', featureId: 'publishing/posts' },
  pages: [
    { id: 'publishing/posts', title: 'Posts', href: '/publishing/posts', description: 'Create and manage content across your channels.' },
    { id: 'publishing/calendar', title: 'Calendar', href: '/publishing/calendar', description: 'See what is planned and published.' },
    { id: 'publishing/queue', title: 'Queue', href: '/publishing/queue', description: 'Review work waiting to publish.' },
    { id: 'publishing/approvals', title: 'Approvals', href: '/publishing/approvals', description: 'Review posts before they go live.' },
    ...MEDIA_PAGES,
    ...FEEDS_PAGES,
    { id: 'publishing/collaboration', title: 'Organize', href: '/publishing/collaboration', description: 'Label posts, manage custom fields and collaborate with your team.' },
    { id: 'publishing/labels', title: 'Labels', href: '/publishing/labels', description: 'Organize workspace content with shared labels.' },
    { id: 'publishing/templates', title: 'Templates', href: '/publishing/templates', description: 'Create and reuse workspace post templates.' },
  ],
} as const satisfies ModuleManifest;
