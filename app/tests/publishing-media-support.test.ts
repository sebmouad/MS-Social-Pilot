import { describe, expect, it } from 'vitest';
import { parsePublishingMedia, publishingMediaIssue, validatePublishingMediaSupport } from '../src/modules/publishing/media-support';
import type { PublishingMediaSupport } from '../src/platforms/types';

const media = (kind: 'image' | 'video', url = `https://cdn.test/${kind}`) => ({ kind, url });
const mixedSupport: PublishingMediaSupport = {
  kinds: ['image', 'video'], maxImages: null, maxVideos: null,
  mixedKinds: true, linkWithMedia: true, imageAltText: true,
};

describe('provider-neutral publishing media support', () => {
  it('allows a combination explicitly supported by the selected platform', () => {
    expect(() => validatePublishingMediaSupport([media('image'), media('video')], 'https://example.test', mixedSupport)).not.toThrow();
    expect(publishingMediaIssue(mixedSupport, [media('image'), media('video')], 'https://example.test')).toBeNull();
  });

  it('fails closed when selected media has no module declaration', () => {
    expect(() => validatePublishingMediaSupport([media('image')], null, undefined)).toThrow('Media publishing is unavailable for this destination.');
  });

  it('rejects unsupported kinds, count ceilings, combinations, links, and descriptions', () => {
    const support: PublishingMediaSupport = {
      kinds: ['image', 'video'], maxImages: null, maxVideos: 1,
      mixedKinds: false, linkWithMedia: false, imageAltText: false,
    };
    expect(() => validatePublishingMediaSupport([media('video'), media('video')], null, support)).toThrow(/video/i);
    expect(() => validatePublishingMediaSupport([media('image'), media('video')], null, support)).toThrow(/combine/i);
    expect(() => validatePublishingMediaSupport([media('image')], 'https://example.test', support)).toThrow(/combine/i);
    expect(() => validatePublishingMediaSupport([{ ...media('image'), altText: 'description' }], null, support)).toThrow(/description/i);
    expect(() => validatePublishingMediaSupport([media('image')], null, { ...support, kinds: ['video'] })).toThrow(/image/i);
  });

  it('parses only complete safe media items and preserves their order', () => {
    expect(parsePublishingMedia([
      { kind: 'image', url: 'media:123e4567-e89b-42d3-a456-426614174000', altText: 'Cover' },
      { kind: 'video', url: 'https://cdn.test/clip.mp4' },
    ])).toEqual([
      { kind: 'image', url: 'media:123e4567-e89b-42d3-a456-426614174000', altText: 'Cover' },
      { kind: 'video', url: 'https://cdn.test/clip.mp4' },
    ]);
    for (const unsafe of [
      [{ kind: 'image', url: 'https://cdn.test/a.jpg', clientId: 'secret-ish' }],
      [{ kind: 'image', url: 'https://cdn.test/a.jpg', localFile: { bytes: [1] } }],
      [{ kind: 'image', url: 'https://cdn.test/a.jpg', altText: 4 }],
      [{ kind: 'audio', url: 'https://cdn.test/a.mp3' }],
      { kind: 'image', url: 'https://cdn.test/a.jpg' },
    ]) expect(() => parsePublishingMedia(unsafe)).toThrow(/media/i);
  });
});
