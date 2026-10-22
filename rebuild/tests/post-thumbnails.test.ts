import { instantFormatter } from '@/server/instant-labels';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PostThumb } from '@/components/PostThumb';
import { postThumbnail } from '@/components/post-thumbnail';
import { QueueTimeline } from '@/modules/publishing/ui/queue/QueueTimeline';
import { PostsTable } from '@/modules/analytics/ui/posts/PostsTable';
import { postsTableRows } from '@/modules/analytics/ui/posts/rows';

const id = '123e4567-e89b-42d3-a456-426614174000';

describe('postThumbnail', () => {
  it('resolves a library image through the authorized media route', () => {
    expect(postThumbnail([{ kind: 'image', url: `media:${id}` }])).toEqual({ url: `/api/media/${id}`, video: false, count: 1 });
  });
  it('prefers the first displayable image and counts every attachment', () => {
    expect(postThumbnail([{ kind: 'image', url: 'javascript:alert(1)' }, { kind: 'image', url: 'https://cdn.example.test/a.jpg' }, { kind: 'video', url: 'https://cdn.example.test/v.mp4' }]))
      .toEqual({ url: 'https://cdn.example.test/a.jpg', video: false, count: 3 });
  });
  it('uses a video poster when stored and a play mark otherwise', () => {
    expect(postThumbnail([{ kind: 'video', url: 'https://cdn.example.test/v.mp4', posterUrl: 'https://cdn.example.test/p.jpg' }])?.url).toBe('https://cdn.example.test/p.jpg');
    expect(postThumbnail([{ kind: 'video', url: 'https://cdn.example.test/v.mp4' }])).toEqual({ url: null, video: true, count: 1 });
  });
  it('falls back to a stored picture URL and to null when nothing is stored', () => {
    expect(postThumbnail([], 'https://cdn.example.test/pic.jpg')?.url).toBe('https://cdn.example.test/pic.jpg');
    expect(postThumbnail(null)).toBeNull();
    expect(postThumbnail([], 'ftp://nope')).toBeNull();
  });
});

describe('PostThumb', () => {
  it('renders the image decoratively with an attachment count', () => {
    const html = renderToStaticMarkup(createElement(PostThumb, { thumb: { url: 'https://cdn.example.test/a.jpg', video: false, count: 3 } }));
    expect(html).toContain('src="https://cdn.example.test/a.jpg"');
    expect(html).toContain('alt=""');
    expect(html).toContain('+2');
  });
  it('shows a named placeholder when there is no image', () => {
    const html = renderToStaticMarkup(createElement(PostThumb, { thumb: null, label: 'No image' }));
    expect(html).toContain('data-empty');
    expect(html).toContain('aria-label="No image"');
    expect(html).not.toContain('<img');
  });
});

describe('thumbnail placement', () => {
  it('shows each queued post thumbnail in the channel timeline', () => {
    const html = renderToStaticMarkup(createElement(QueueTimeline, {
      maxPerChannel: 3,
      posts: [{ id: 'p1', message: 'Hello', link: null, media: [{ kind: 'image', url: `media:${id}` }], status: 'scheduled', scheduledAt: new Date('2026-10-22T10:00:00Z'), targets: [{ status: 'pending', target: { id: 'c1', name: 'Studio', pictureUrl: null } }] }],
    }));
    expect(html).toContain(`/api/media/${id}`);
  });
  it('shows the Analytics post explorer thumbnail from the row', () => {
    const rows = postsTableRows([{ channelId: 'c1', channelName: 'Studio', postId: 'p1', text: 'Hi', url: null, publishedAt: null, measuredAt: null, measures: [{ key: 'views', value: 3 }], thumbnail: { url: 'https://cdn.example.test/t.jpg', video: false, count: 1 } }], instantFormatter('UTC', 'en'));
    const html = renderToStaticMarkup(createElement(PostsTable, { rows, measures: [{ key: 'views', label: 'Views' }], locale: 'en' }));
    expect(html).toContain('https://cdn.example.test/t.jpg');
  });
});
