import { describe, expect, it } from 'vitest';
import { decodeSubmittedStatusCursor, encodeSubmittedStatusCursor, submittedContentKind } from '@/platforms/facebook/submitted-jobs';

describe('Facebook submitted-status job helpers', () => {
  it('encodes and validates a bounded timestamp/id cursor', () => {
    const row = { updatedAt: new Date('2026-10-19T12:30:00.000Z'), id: 'operation-7' };
    const encoded = encodeSubmittedStatusCursor(row);
    expect(encoded).toBe('["2026-10-19T12:30:00.000Z","operation-7"]');
    expect(decodeSubmittedStatusCursor(encoded)).toEqual({ updatedAt: '2026-10-19T12:30:00.000Z', id: 'operation-7' });
    expect(decodeSubmittedStatusCursor('x'.repeat(4097))).toBeNull();
    expect(decodeSubmittedStatusCursor('["not-a-date","operation-7"]')).toBeNull();
    expect(decodeSubmittedStatusCursor('["2026-10-19T12:30:00.000Z","bad\\nid"]')).toBeNull();
    expect(() => encodeSubmittedStatusCursor({ ...row, id: 'x'.repeat(2049) })).toThrow();
  });

  it('uses video precedence when a post has mixed media', () => {
    expect(submittedContentKind(null)).toBe('text');
    expect(submittedContentKind([{ kind: 'image' }])).toBe('image');
    expect(submittedContentKind([{ kind: 'image' }, { kind: 'video' }])).toBe('video');
    expect(submittedContentKind([{ type: 'video' }])).toBe('text');
  });
});
