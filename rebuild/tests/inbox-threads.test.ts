import { describe, expect, it } from 'vitest';
import { commentNeedsReply, conversationNeedsReply, formatInboxTime, isFromChannel, replyRule } from '../src/server/inbox/threads';
import { messengerReplyWindow } from '../src/server/inbox/reply-window';

const visitor = { fromId: 'visitor-1', sentById: null };
const sentHere = { fromId: null, sentById: 'user-1' };
const channelAuthored = { fromId: 'page-1', sentById: null };

describe('inbox thread state', () => {
  it('treats messages sent from the app or authored by the channel as the channel side', () => {
    expect(isFromChannel(sentHere, 'page-1')).toBe(true);
    expect(isFromChannel(channelAuthored, 'page-1')).toBe(true);
    expect(isFromChannel(visitor, 'page-1')).toBe(false);
  });

  it('flags a conversation as needing a reply only while open and last spoken by the other side', () => {
    expect(conversationNeedsReply(visitor, 'page-1', false)).toBe(true);
    expect(conversationNeedsReply(sentHere, 'page-1', false)).toBe(false);
    expect(conversationNeedsReply(visitor, 'page-1', true)).toBe(false);
    expect(conversationNeedsReply(undefined, 'page-1', false)).toBe(false);
  });

  it('flags a comment as needing a reply until the channel answers, resolves or hides it', () => {
    expect(commentNeedsReply([], 'page-1', { resolved: false, hidden: false })).toBe(true);
    expect(commentNeedsReply([sentHere], 'page-1', { resolved: false, hidden: false })).toBe(false);
    expect(commentNeedsReply([channelAuthored], 'page-1', { resolved: false, hidden: false })).toBe(false);
    expect(commentNeedsReply([], 'page-1', { resolved: true, hidden: false })).toBe(false);
    expect(commentNeedsReply([], 'page-1', { resolved: false, hidden: true })).toBe(false);
  });
});

describe('reply rule wording', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const base = { windowHours: 24, timeZone: 'America/New_York' };

  it('states the deadline in the workspace time zone while the window is open', () => {
    const window = messengerReplyWindow({ messages: [{ fromId: 'visitor-1', createdTime: new Date('2026-10-15T08:00:00Z') }], pageId: 'page-1', windowHours: 24, now });
    const rule = replyRule({ kind: 'message', window, ...base });
    expect(rule.allowed).toBe(true);
    expect(rule.headline).toBe('Replies are possible until Oct 16, 4:00 AM EDT.');
    expect(rule.detail).toContain('24 hours');
  });

  it('says when the window closed and when replies become possible again', () => {
    const window = messengerReplyWindow({ messages: [{ fromId: 'visitor-1', createdTime: new Date('2026-10-13T08:00:00Z') }], pageId: 'page-1', windowHours: 24, now });
    const rule = replyRule({ kind: 'message', window, ...base });
    expect(rule.allowed).toBe(false);
    expect(rule.headline).toBe('The reply window closed Oct 14, 4:00 AM EDT.');
    expect(rule.detail).toMatch(/after the person writes/);
  });

  it('explains a thread with no message from the other side and allows comment replies', () => {
    const none = replyRule({ kind: 'message', window: messengerReplyWindow({ messages: [], pageId: 'page-1', windowHours: 24, now }), ...base });
    expect(none.allowed).toBe(false);
    expect(none.headline).toMatch(/no message/);
    expect(replyRule({ kind: 'comment' }).allowed).toBe(true);
  });

  it('formats times in the given zone with an optional abbreviation', () => {
    expect(formatInboxTime(new Date('2026-10-15T23:30:00Z'), 'Pacific/Honolulu')).toBe('Oct 15, 1:30 PM');
    expect(formatInboxTime(new Date('2026-10-15T23:30:00Z'), 'UTC', true)).toBe('Oct 15, 11:30 PM UTC');
  });
});
