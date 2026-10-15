import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/server/data', () => ({ prisma: {} }));
import { assertLocalImageLimits, validatePostAttachments } from '../src/server/publishing/lifecycle';

describe('post attachment validation', () => {
  it('normalizes a public HTTPS link or media URL for persisted drafts', () => {
    expect(validatePostAttachments({ link: ' https://example.com/article ' }, 2, 500)).toEqual({ link: 'https://example.com/article', media: [] });
    expect(validatePostAttachments({ media: [{ kind: 'image', url: 'https://example.com/photo.jpg' }] }, 2, 500).media).toEqual([{ kind: 'image', url: 'https://example.com/photo.jpg' }]);
  });

  it('rejects insecure URLs and combinations the active publishing engine would drop', () => {
    expect(() => validatePostAttachments({ link: 'http://example.com' }, 2, 500)).toThrow(/HTTPS/);
    expect(() => validatePostAttachments({ link: 'https://example.com', media: [{ kind: 'image', url: 'https://example.com/i.jpg' }] }, 2, 500)).toThrow(/cannot be combined/);
    expect(() => validatePostAttachments({ media: [{ kind: 'image', url: 'https://example.com/i.jpg' }, { kind: 'video', url: 'https://example.com/v.mp4' }] }, 2, 500)).toThrow(/cannot be combined/);
    expect(() => validatePostAttachments({ media: [{ kind: 'image', url: 'https://example.com/i.jpg' }] }, 0, 500)).toThrow(/Choose up to/);
  });

  it('keeps valid local image references but never persists client-supplied bytes', () => {
    const reference = 'media:123e4567-e89b-42d3-a456-426614174000';
    expect(validatePostAttachments({ media: [{ kind: 'image', url: reference, localFile: { bytes: new Uint8Array([1]), mimeType: 'image/jpeg', fileName: 'x' } }] }, 2, 500).media).toEqual([{ kind: 'image', url: reference }]);
    expect(() => validatePostAttachments({ media: [{ kind: 'image', url: 'media:../../other-workspace' }] }, 2, 500)).toThrow();
    expect(() => validatePostAttachments({ media: [{ kind: 'video', url: reference }] }, 2, 500)).toThrow(/HTTPS/);
  });

  it('enforces Root-managed image description length', () => {
    expect(() => validatePostAttachments({ media: [{ kind: 'image', url: 'https://example.com/i.jpg', altText: 'Too long' }] }, 2, 3)).toThrow(/3 characters/);
  });

  it('checks destination-specific image size and type before remote publishing', () => {
    const image = { kind: 'image' as const, url: 'media:123e4567-e89b-42d3-a456-426614174000', localFile: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png', fileName: 'image' } };
    expect(() => assertLocalImageLimits({ localImageUpload: { maxBytes: 3, mimeTypes: ['image/png'] } }, [image])).not.toThrow();
    expect(() => assertLocalImageLimits({ localImageUpload: { maxBytes: 2, mimeTypes: ['image/png'] } }, [image])).toThrow(/type and size/);
    expect(() => assertLocalImageLimits({ localImageUpload: { maxBytes: 3, mimeTypes: ['image/jpeg'] } }, [image])).toThrow(/type and size/);
    expect(() => assertLocalImageLimits({}, [image])).toThrow(/type and size/);
  });
});
