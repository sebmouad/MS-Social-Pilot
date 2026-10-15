import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/server/data', () => ({ prisma: {} }));
import { validatePostAttachments } from '../src/server/publishing/lifecycle';

describe('post attachment validation', () => {
  it('normalizes a public HTTPS link or media URL for persisted drafts', () => {
    expect(validatePostAttachments({ link: ' https://example.com/article ' }, 2)).toEqual({ link: 'https://example.com/article', media: [] });
    expect(validatePostAttachments({ media: [{ kind: 'image', url: 'https://example.com/photo.jpg' }] }, 2).media).toEqual([{ kind: 'image', url: 'https://example.com/photo.jpg' }]);
  });

  it('rejects insecure URLs and combinations the active publishing engine would drop', () => {
    expect(() => validatePostAttachments({ link: 'http://example.com' }, 2)).toThrow(/HTTPS/);
    expect(() => validatePostAttachments({ link: 'https://example.com', media: [{ kind: 'image', url: 'https://example.com/i.jpg' }] }, 2)).toThrow(/cannot be combined/);
    expect(() => validatePostAttachments({ media: [{ kind: 'image', url: 'https://example.com/i.jpg' }, { kind: 'video', url: 'https://example.com/v.mp4' }] }, 2)).toThrow(/cannot be combined/);
    expect(() => validatePostAttachments({ media: [{ kind: 'image', url: 'https://example.com/i.jpg' }] }, 0)).toThrow(/Choose up to/);
  });
});
