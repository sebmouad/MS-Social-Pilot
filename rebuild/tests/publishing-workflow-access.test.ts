import { describe, expect, it } from 'vitest';
import { canCancelQueuedPost } from '../src/app/publishing/workflow-access';

describe('queued post cancellation visibility', () => {
  const base = { canWritePosts: true, role: 'member', userId: 'viewer', authorId: 'author' };

  it('requires post write access even when the viewer authored the post', () => {
    expect(canCancelQueuedPost({ ...base, canWritePosts: false, authorId: 'viewer' })).toBe(false);
  });

  it('allows an author with write access and a workspace manager with write access', () => {
    expect(canCancelQueuedPost({ ...base, authorId: 'viewer' })).toBe(true);
    expect(canCancelQueuedPost({ ...base, role: 'editor' })).toBe(true);
  });

  it('does not offer cancellation to an unrelated member without manager authority', () => {
    expect(canCancelQueuedPost(base)).toBe(false);
  });
});
