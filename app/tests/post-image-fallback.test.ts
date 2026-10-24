import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Static rendering cannot fire <img onError>, so the failed-source state is forced through useState.
const h = vi.hoisted(() => ({ failed: null as string | null }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useState: ((initial: unknown) => (h.failed !== null ? [h.failed, () => undefined] : actual.useState(initial))) as typeof actual.useState };
});

import { MediaThumb, PostImage } from '@/modules/publishing/ui/kit/kit';
import { PostPreview } from '@/components/PostPreview';

const id = '123e4567-e89b-42d3-a456-426614174000';
const src = `/api/media/${id}`;

describe('missing media fallback', () => {
  it('renders the image with a failure handler while it has not failed', () => {
    h.failed = null;
    const markup = renderToStaticMarkup(createElement(PostImage, { src, alt: 'Artwork' }));
    expect(markup).toContain(`src="${src}"`);
    expect(markup).not.toContain('data-media-missing');
  });

  it('shows an accessible placeholder instead of a broken image once the source failed', () => {
    h.failed = src;
    const english = renderToStaticMarkup(createElement(PostImage, { src, alt: 'Artwork' }));
    expect(english).toContain('data-media-missing');
    expect(english).toContain('role="img"');
    expect(english).toContain('aria-label="Image unavailable"');
    expect(english).not.toContain('<img');
    const french = renderToStaticMarkup(createElement(PostImage, { src, alt: 'Artwork', locale: 'fr' }));
    expect(french).toContain('aria-label="Image indisponible"');
  });

  it('keeps the image when a different source failed (state is per source)', () => {
    h.failed = '/api/media/other';
    expect(renderToStaticMarkup(createElement(PostImage, { src, alt: 'Artwork' }))).toContain('<img');
  });

  it('applies to table thumbnails and post previews, dropping the link to the missing file', () => {
    h.failed = src;
    const thumb = renderToStaticMarkup(createElement(MediaThumb, { url: src, alt: '', count: 2 }));
    expect(thumb).toContain('data-media-missing');
    expect(thumb).toContain('+1');
    const post = {
      id: 'p1', authorId: 'a1', message: 'Hello', firstComment: null, link: null, media: [{ kind: 'image', url: `media:${id}` }],
      status: 'published', scheduledAt: null, publishedAt: new Date('2026-10-15T12:00:00Z'), createdAt: new Date('2026-10-14T12:00:00Z'), targets: [],
    };
    const preview = renderToStaticMarkup(createElement(PostPreview, { post, authorName: 'Amina', timeZone: 'UTC' }));
    expect(preview).toContain('data-media-missing');
    expect(preview).not.toContain('Open image attachment');
  });
});
