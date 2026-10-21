import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isWaitingToReschedule } from '@/modules/publishing/schedule-state';
import type { BoardDay } from '@/modules/publishing/ui/calendar/types';

const state = vi.hoisted(() => ({ role: 'owner', userId: 'author', write: true, rows: [] as unknown[], board: vi.fn() }));
vi.mock('@/server/context', () => ({ requireViewer: async () => ({
  user: { id: state.userId, name: 'Recipe team' }, workspaceId: 'workspace-a',
  membership: { role: state.role, workspace: { timezone: 'Europe/Paris' } },
  permissions: { features: { 'publishing/posts': { write: state.write } } },
}) }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => state.write }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'publishing.defaultScheduleTime' ? '07:00' : 5 }));
vi.mock('@/modules/publishing/server/read', () => ({
  readPublishingPostPage: async () => ({ posts: state.rows, total: state.rows.length, page: 1, pages: 1 }),
  readPublishingCalendar: async () => ({ posts: state.rows, channels: [], channelUnavailable: false }),
}));
vi.mock('@/modules/publishing/ui/kit/locale', () => ({ pageLocale: async () => 'fr' }));
vi.mock('@/modules/publishing/server/customer-copy', async () => {
  const { publishingCopyDefaults, resolvePublishingCopy } = await import('@/modules/publishing/ui/kit/copy');
  return { loadPublishingCopy: async () => ({ catalog: publishingCopyDefaults, copy: resolvePublishingCopy(publishingCopyDefaults) }) };
});
vi.mock('@/modules/publishing/server/action-copy', async () => {
  const { publishingActionCopy } = await import('@/modules/publishing/action-catalog');
  return { loadPublishingActionCopy: async () => publishingActionCopy };
});
vi.mock('@/modules/publishing/ui/posts/actions', () => ({ cancelScheduledPostAction: vi.fn() }));
vi.mock('@/modules/publishing/ui/queue/RescheduleQueuedPost', () => ({ RescheduleQueuedPost: () => createElement('span', { 'data-reschedule': true }, 'Reschedule') }));
vi.mock('@/components/PostPreview', () => ({ PostPreview: ({ actions }: { actions?: ReactNode }) => actions, formatPostPreviewTime: () => '07:00' }));
vi.mock('@/modules/publishing/ui/calendar/CalendarBoard', () => ({ CalendarBoard: (props: unknown) => { state.board(props); return null; } }));
vi.mock('@/modules/publishing/ui/origins/load', () => ({ loadPostOrigins: async () => new Map(), parseOriginFilter: () => undefined }));
vi.mock('@/modules/settings/server/workspace-operations', () => ({ loadWorkspaceOperations: async () => ({ weekStartsOn: 1 }) }));

import QueueScreen from '@/modules/publishing/ui/queue/QueueScreen';
import CalendarScreen from '@/modules/publishing/ui/calendar/CalendarScreen';

function recipePost() {
  return {
    id: 'recipe-apple-tart', authorId: 'author', message: 'Tarte aux pommes', firstComment: 'Ingrédients et préparation',
    firstCommentDelayMinutes: 15, link: null, media: [{ kind: 'image', url: 'https://images.example.test/recipe.jpg' }],
    status: 'scheduled', scheduledAt: new Date('2026-10-25T06:00:00Z'), publishedAt: null, createdAt: new Date('2026-10-21T10:00:00Z'),
    targets: Array.from({ length: 10 }, (_, i) => ({
      id: `destination-${i}`, status: i % 2 ? 'pending' : 'scheduled_remote', remotePostId: i % 2 ? null : `remote-${i}`, remoteUrl: null,
      firstCommentId: null as string | null, firstCommentAt: null as Date | null, firstCommentError: null as string | null,
      target: { id: `page-${i}`, name: `Recipe Page ${i + 1}`, pictureUrl: null, socialAccount: { provider: 'facebook' } },
    })),
  };
}

beforeEach(() => { vi.clearAllMocks(); state.role = 'owner'; state.userId = 'author'; state.write = true; state.rows = [recipePost()]; });

async function renderScreens() {
  const queue = renderToStaticMarkup(await QueueScreen({ searchParams: Promise.resolve({}) }));
  renderToStaticMarkup(await CalendarScreen({ searchParams: Promise.resolve({ view: 'week', date: '2026-10-25' }) }));
  const props = state.board.mock.calls.at(-1)![0] as { days: BoardDay[] };
  return { queue, movable: props.days.flatMap(day => day.posts).map(post => post.movable) };
}

describe('mixed app/platform recipe schedule controls', () => {
  it.each(['owner', 'admin', 'editor'])('offers rescheduling in Queue and Calendar to a %s', async role => {
    state.role = role; state.userId = 'manager';
    const result = await renderScreens();
    expect(result.queue).toContain('data-reschedule="true"');
    expect(result.movable).toEqual([true]);
  });
  it('offers rescheduling to the contributor who authored the post', async () => {
    state.role = 'contributor';
    const result = await renderScreens();
    expect(result.queue).toContain('data-reschedule="true"');
    expect(result.movable).toEqual([true]);
  });
  it.each(['viewer', 'unrelated member'])('hides both controls for a %s', async kind => {
    state.role = kind === 'viewer' ? 'viewer' : 'member'; state.userId = 'other'; state.write = kind !== 'viewer';
    const result = await renderScreens();
    expect(result.queue).not.toContain('data-reschedule="true"');
    expect(result.movable).toEqual([false]);
  });
  it.each(['published', 'processing', 'failed'])('hides both controls once a destination is %s', async status => {
    const post = recipePost(); post.targets[0]!.status = status; state.rows = [post];
    const result = await renderScreens();
    expect(result.queue).not.toContain('data-reschedule="true"');
    expect(result.movable).toEqual([false]);
  });
  it('refuses pending destinations with a recorded remote identity', () => {
    const post = recipePost(); post.targets[0]!.status = 'pending';
    expect(isWaitingToReschedule(post)).toBe(false);
  });
  it('preserves confirmed comment delivery in the calendar preview instead of offering a misleading unsent status', async () => {
    const post = recipePost();
    post.status = 'published';
    post.targets[0]!.status = 'published';
    post.targets[0]!.firstCommentId = 'comment-1';
    post.targets[0]!.firstCommentAt = new Date('2026-10-25T06:15:00Z');
    state.rows = [post];
    await renderScreens();
    const props = state.board.mock.calls.at(-1)![0] as { days: BoardDay[] };
    expect(props.days.flatMap(day => day.posts)[0]!.preview?.targets[0]).toMatchObject({
      id: 'destination-0', firstCommentId: 'comment-1', firstCommentAt: post.targets[0]!.firstCommentAt, firstCommentError: null,
    });
  });
});
