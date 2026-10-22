import type { ModuleManifest } from '../types';
import { MEDIA_JOBS, MEDIA_PAGES, MEDIA_ROOT_KEYS } from '../media/manifest';
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
    ...MEDIA_JOBS,
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
  href: '/content',
  primaryAction: { href: '/create', label: 'New post', featureId: 'publishing/posts' },
  /** Design v2 B2/B3: Publishing's routes became the Content area and the full-screen Create composer. */
  redirects: [
    { from: '/publishing/posts', to: '/content' },
    { from: '/publishing/compose', to: '/create' },
    { from: '/publishing/calendar/*', to: '/content/calendar/*' },
    { from: '/publishing/queue', to: '/content/queue' },
    { from: '/publishing/approvals', to: '/content/approvals' },
    { from: '/publishing/media', to: '/content/library' },
    { from: '/publishing/templates', to: '/content/library/templates' },
    { from: '/publishing/labels', to: '/content/library/labels' },
    { from: '/publishing/collaboration/post/*', to: '/content/post/*' },
    { from: '/publishing/collaboration', to: '/content/library/fields' },
    { from: '/publishing/feeds', to: '/content/feeds' },
    { from: '/publishing/ai-studio', to: '/content/ai-studio' },
    /** 2026-10-22 UX organization: Feeds left the Library sections for its own Content tab. */
    { from: '/content/library/feeds', to: '/content/feeds' },
  ],
  pages: [
    { id: 'publishing/posts', title: 'Posts', href: '/content', description: 'Create and manage content across your channels.' },
    { id: 'publishing/calendar', title: 'Calendar', href: '/content/calendar', description: 'See what is planned and published.' },
    { id: 'publishing/queue', title: 'Queue', href: '/content/queue', description: 'Review work waiting to publish.' },
    { id: 'publishing/approvals', title: 'Approvals', href: '/content/approvals', description: 'Review posts before they go live.' },
    ...MEDIA_PAGES,
    // Feeds is its own Content-area tab (2026-10-22 UX organization); the rest are tabs inside Library, not tabs of the Content area.
    ...FEEDS_PAGES,
    { id: 'publishing/ai-studio', title: 'AI studio', href: '/content/ai-studio', description: 'Generate images, video and voice, and check a post before publishing.' },
    { id: 'publishing/collaboration', title: 'Fields', href: '/content/library/fields', navigation: false, description: 'Label posts, manage custom fields and collaborate with your team.' },
    { id: 'publishing/labels', title: 'Labels', href: '/content/library/labels', navigation: false, description: 'Organize workspace content with shared labels.' },
    { id: 'publishing/templates', title: 'Templates', href: '/content/library/templates', navigation: false, description: 'Create and reuse workspace post templates.' },
  ],
} as const satisfies ModuleManifest;
