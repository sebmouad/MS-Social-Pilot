import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routerState = vi.hoisted(() => ({ pathname: '/publishing/posts', query: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => routerState.pathname,
  useSearchParams: () => new URLSearchParams(routerState.query),
}));

import { PostPreview } from '@/components/PostPreview';
import { PostFilters } from '@/app/publishing/posts/PostFilters';

const localImageId = '123e4567-e89b-42d3-a456-426614174000';
const post = {
  id: 'post-1', authorId: 'author-1', message: 'A real post preview.', firstComment: 'A useful follow-up.',
  link: 'https://example.test/article', media: [{ kind: 'image', url: `media:${localImageId}`, altText: 'Campaign artwork' }],
  status: 'published', scheduledAt: null, publishedAt: new Date('2026-10-15T12:00:00.000Z'), createdAt: new Date('2026-10-14T12:00:00.000Z'),
  targets: [{ status: 'published', remotePostId: 'remote-1', remoteUrl: 'https://social.example.test/post/1', target: { id: 'channel-1', type: 'page', name: 'Studio', pictureUrl: 'https://cdn.example.test/studio.jpg' } }],
};

describe('PostPreview', () => {
  it('uses the supplied workspace time without recalculating it in another runtime', () => {
    const formatter = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => { throw new Error('Different browser timezone data'); });
    try {
      const markup = renderToStaticMarkup(createElement(PostPreview, { post: { ...post, displayTime: 'Oct 15, 2026, 1:00 PM' }, authorName: 'Amina', timeZone: 'Africa/Casablanca' }));
      expect(markup).toContain('Published Oct 15, 2026, 1:00 PM');
      expect(markup).toContain('dateTime="2026-10-15T12:00:00.000Z"');
      expect(formatter).not.toHaveBeenCalled();
    } finally { formatter.mockRestore(); }
  });

  it('shows a safe first-comment state beside each destination without exposing stored errors', () => {
    const uncertain = { ...post, targets: [{ ...post.targets[0]!, id: 'post-target-a', firstCommentAt: new Date(), firstCommentError: 'private provider error detail' }] };
    const markup = renderToStaticMarkup(createElement(PostPreview, { post: uncertain, authorName: 'Amina', timeZone: 'UTC' }));
    expect(markup).toContain('First comment needs review');
    expect(markup).not.toContain('private provider error detail');
  });

  it('renders private media through the authorized local media route and rejects unsafe URLs', () => {
    const markup = renderToStaticMarkup(createElement(PostPreview, {
      post: { ...post, link: 'javascript:alert(1)', media: [...post.media, { kind: 'video', url: 'javascript:alert(2)' }], targets: [{ ...post.targets[0], remoteUrl: 'javascript:alert(3)' }] },
      authorName: 'Amina', timeZone: 'UTC',
    }));

    expect(markup).toContain(`src="/api/media/${localImageId}"`);
    expect(markup).toContain('https://cdn.example.test/studio.jpg');
    expect(markup).not.toContain('javascript:');
    expect(markup).not.toContain(`media:${localImageId}`);
  });

  it('shows actual post text, first comment, delivery status, destination link, and timestamp', () => {
    const markup = renderToStaticMarkup(createElement(PostPreview, { post, authorName: 'Amina', timeZone: 'UTC' }));

    expect(markup).toContain('A real post preview.');
    expect(markup).toContain('A useful follow-up.');
    expect(markup).toContain('published');
    expect(markup).toContain('Studio');
    expect(markup).toContain('https://social.example.test/post/1');
    expect(markup).toContain('dateTime="2026-10-15T12:00:00.000Z"');
    expect(markup).toContain('Amina');
  });

  it('renders a safe video attachment and the saved shared link', () => {
    const markup = renderToStaticMarkup(createElement(PostPreview, {
      post: { ...post, media: [{ kind: 'video', url: 'https://cdn.example.test/clip.mp4' }] },
      authorName: 'Amina', timeZone: 'UTC',
    }));

    expect(markup).toContain('<source src="https://cdn.example.test/clip.mp4"');
    expect(markup).toContain('href="https://example.test/article"');
    expect(markup).toContain('Open shared link');
  });

  it('keeps temporary blob URLs restricted to an explicit trusted authoring slot', () => {
    const temporaryPost = { ...post, media: [{ kind: 'image', url: 'blob:local-preview' }] };
    const savedMarkup = renderToStaticMarkup(createElement(PostPreview, { post: temporaryPost, authorName: 'Amina', timeZone: 'UTC' }));
    const authoringMarkup = renderToStaticMarkup(createElement(PostPreview, {
      post: temporaryPost,
      authorName: 'Amina',
      timeZone: 'UTC',
      mediaOverride: createElement('img', { src: 'blob:local-preview', alt: 'Temporary file preview' }),
    }));

    expect(savedMarkup).not.toContain('blob:local-preview');
    expect(authoringMarkup).toContain('blob:local-preview');
  });
});

describe('PostFilters view selection', () => {
  beforeEach(() => { routerState.pathname = '/publishing/posts'; routerState.query = ''; });

  it('defaults to Table and makes Feed and Cards selectable', () => {
    const markup = renderToStaticMarkup(createElement(PostFilters, { channels: [], currentMonth: '2026-10' }));

    expect(markup).toContain('name="view"');
    expect(markup).toMatch(/<option value="table" selected="">Table<\/option>/);
    expect(markup).toContain('<option value="feed">Feed</option>');
    expect(markup).toContain('<option value="cards">Cards</option>');
  });

  it('retains the selected view and existing filters in the sidebar form', () => {
    routerState.query = 'view=feed&status=scheduled&channel=channel-1';
    const markup = renderToStaticMarkup(createElement(PostFilters, { channels: [{ id: 'channel-1', name: 'Studio' }], currentMonth: '2026-10' }));

    expect(markup).toMatch(/<option value="feed" selected="">Feed<\/option>/);
    expect(markup).toMatch(/<option value="scheduled" selected="">Scheduled<\/option>/);
    expect(markup).toMatch(/<option value="channel-1" selected="">Studio<\/option>/);
  });

  it('commits literal search with current filters and configured max length', () => {
    routerState.query = 'view=feed&status=scheduled&channel=channel-1&q=summer';
    const markup = renderToStaticMarkup(createElement(PostFilters, { channels: [{ id: 'channel-1', name: 'Studio' }], currentMonth: '2026-10', searchMaxCharacters: 150 }));

    expect(markup).toContain('name="q"');
    expect(markup).toMatch(/<input[^>]*maxLength="150"/);
    expect(markup).toMatch(/<input[^>]*name="q"[^>]*value="summer"/);
    expect(markup).toContain('Search posts');
    expect(markup).toMatch(/<option value="feed" selected="">Feed<\/option>/);
    expect(markup).toMatch(/<option value="scheduled" selected="">Scheduled<\/option>/);
    expect(markup).toMatch(/<option value="channel-1" selected="">Studio<\/option>/);
    expect(markup).toContain('first comments');
  });
});
