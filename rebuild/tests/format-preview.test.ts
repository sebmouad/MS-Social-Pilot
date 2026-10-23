import { describe, expect, it } from 'vitest';
import { availablePublishingFormats } from '../src/modules/publishing/formats';
import { createFacebookAdapter } from '../src/platforms/facebook/publishing';
import type { FacebookConfig } from '../src/platforms/facebook/config';
import { createInstagramAdapter } from '../src/platforms/instagram/adapter';
import { INSTAGRAM_POLICY_DEFAULTS } from '../src/platforms/instagram/config';

const facebookConfig: FacebookConfig = {
  graphBaseUrl: 'https://graph.facebook.test', oauthBaseUrl: 'https://www.facebook.test', graphVersion: 'v99.0', requestTimeoutMs: 2_000,
  maxPages: 4, pageSize: 25, pageInsightMetrics: ['page_views_total'], adInsightFields: ['spend'], maxImageUploadBytes: 1024, allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: false,
};
const fetchImpl = (async () => new Response(JSON.stringify({ data: [] }), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
const feedMedia = { kinds: ['image'] as const, maxImages: 1, maxVideos: 0, mixedKinds: false, linkWithMedia: false, imageAltText: false };
const feed = { id: 'post', label: 'Feed post', media: feedMedia, firstComment: true, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false } };

describe('per-format preview hints (UI wave 2)', () => {
  it('passes valid preview hints through and drops empty ones', () => {
    const [withHints, withoutHints, emptied] = availablePublishingFormats([
      { ...feed, preview: { textFoldChars: 480, mediaAspect: 'story', caption: false } },
      { ...feed, id: 'plain' },
      { ...feed, id: 'other', preview: {} },
    ]);
    expect(withHints!.preview).toEqual({ textFoldChars: 480, mediaAspect: 'story', caption: false });
    expect(withoutHints!.preview).toBeUndefined();
    expect(emptied!.preview).toBeUndefined();
  });
  it('fails closed on malformed preview hints and drops unknown ones', () => {
    for (const preview of [{ textFoldChars: 5 }, { textFoldChars: 1.5 }, { mediaAspect: 'circle' }, { caption: 'yes' }]) {
      expect(() => availablePublishingFormats([{ ...feed, preview }]), JSON.stringify(preview)).toThrow();
    }
    const [cleaned] = availablePublishingFormats([{ ...feed, preview: { textFoldChars: 480, mediaAspect: null, caption: true, extra: 1 } }]);
    expect(cleaned!.preview).toEqual({ textFoldChars: 480 });
  });
  it('keeps Facebook feed folding and story shapes module-owned', () => {
    const native = { publish: async () => ({ remoteId: 'x', url: null, state: 'published' as const }), videoLabel: 'Video', reelLabel: 'Reel', storyPhotoLabel: 'Photo story', storyVideoLabel: 'Video story' };
    const adapter = createFacebookAdapter(facebookConfig, fetchImpl, { feedFormatLabel: 'Feed post', native });
    const formats = availablePublishingFormats(adapter.publishingFormats);
    expect(formats.find(format => format.id === 'post')?.preview).toEqual({ textFoldChars: 480 });
    const story = formats.find(format => format.id === 'story_photo');
    expect(story?.firstComment).toBe(false);
    expect(story?.preview).toEqual({ mediaAspect: 'story', caption: false });
    expect(formats.find(format => format.id === 'reel')?.preview).toEqual({ textFoldChars: 480, mediaAspect: 'story' });
  });
  it('keeps Instagram caption folding and story rendering module-owned', () => {
    const adapter = createInstagramAdapter({ ...INSTAGRAM_POLICY_DEFAULTS, appSecretProofEnabled: false }, {});
    const formats = availablePublishingFormats(adapter.publishingFormats);
    expect(formats.find(format => format.id === 'image')?.preview).toEqual({ textFoldChars: 125 });
    const story = formats.find(format => format.id === 'story');
    expect(story?.firstComment).toBe(false);
    expect(story?.preview).toEqual({ mediaAspect: 'story', caption: false });
  });
});
