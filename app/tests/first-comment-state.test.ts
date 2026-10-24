import { describe, expect, it } from 'vitest';
import { FIRST_COMMENT_REJECTED, firstCommentState } from '../src/modules/publishing/first-comment-state';

describe('first comment receipt state', () => {
  const published = { status: 'published', remotePostId: 'remote-post' };

  it('distinguishes omitted, awaiting, ready, sent and uncertain comments', () => {
    expect(firstCommentState('', published)).toBe('not_requested');
    expect(firstCommentState('Follow-up', { status: 'pending', remotePostId: null })).toBe('awaiting_post');
    expect(firstCommentState('Follow-up', published)).toBe('ready');
    expect(firstCommentState('Follow-up', { ...published, firstCommentId: 'remote-comment' })).toBe('sent');
    expect(firstCommentState('Follow-up', { ...published, firstCommentAt: new Date() })).toBe('needs_review');
    expect(firstCommentState('Follow-up', { ...published, firstCommentError: 'rebuild:first_comment_uncertain' })).toBe('needs_review');
  });

  it('releases only an explicit rejection for operator retry', () => {
    expect(firstCommentState('Follow-up', { ...published, firstCommentError: FIRST_COMMENT_REJECTED })).toBe('ready');
    expect(firstCommentState('Follow-up', { ...published, firstCommentError: 'legacy-unknown-error' })).toBe('needs_review');
  });
});
