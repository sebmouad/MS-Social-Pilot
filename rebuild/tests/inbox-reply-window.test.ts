import { describe, expect, it } from 'vitest';
import { messengerReplyWindow } from '../src/server/inbox/reply-window';

const now = new Date('2026-10-15T12:00:00.000Z');

describe('Messenger reply window', () => {
  it('uses the latest visitor message and ignores Page replies', () => {
    const state = messengerReplyWindow({
      pageId: 'page-1', windowHours: 24, now,
      messages: [
        { fromId: 'page-1', createdTime: new Date('2026-10-15T11:00:00.000Z') },
        { fromId: 'visitor-1', createdTime: new Date('2026-10-15T02:00:00.000Z') },
      ],
    });
    expect(state).toEqual({ state: 'open', until: new Date('2026-10-16T02:00:00.000Z'), lastInboundAt: new Date('2026-10-15T02:00:00.000Z') });
  });

  it('finds the latest visitor message even when stored messages arrive out of order', () => {
    const state = messengerReplyWindow({ pageId: 'page-1', windowHours: 24, now, messages: [
      { fromId: 'visitor-1', createdTime: new Date('2026-10-13T02:00:00.000Z') },
      { fromId: 'visitor-1', createdTime: new Date('2026-10-15T02:00:00.000Z') },
    ] });
    expect(state.state).toBe('open');
  });

  it('closes only after the configured cutoff and handles threads without a visitor message', () => {
    expect(messengerReplyWindow({ pageId: 'page-1', windowHours: 1, now, messages: [
      { fromId: 'visitor-1', createdTime: new Date('2026-10-15T11:00:00.000Z') },
    ] }).state).toBe('open');
    expect(messengerReplyWindow({ pageId: 'page-1', windowHours: 1, now, messages: [
      { fromId: 'visitor-1', createdTime: new Date('2026-10-15T10:59:59.999Z') },
    ] }).state).toBe('closed');
    expect(messengerReplyWindow({ pageId: 'page-1', windowHours: 24, now, messages: [
      { fromId: 'page-1', createdTime: new Date('2026-10-15T11:00:00.000Z') },
      { fromId: null, createdTime: new Date('2026-10-15T10:00:00.000Z') },
    ] })).toEqual({ state: 'no_recipient' });
  });
});
