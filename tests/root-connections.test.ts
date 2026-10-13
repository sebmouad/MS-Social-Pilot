import { describe, expect, it } from 'vitest';

import { connectionStatus, groupByPlatform, platformOf } from '@/lib/root-connections';

const row = (type: string, name: string, status: 'ok' | 'paused' | 'blocked' | 'reconnect' = 'ok', workspaceName = 'Client A') => ({
  type,
  name,
  status,
  workspaceName,
});

describe('root connections grouping', () => {
  it('puts Pages and Groups under Facebook', () => {
    expect(platformOf('page')).toBe('facebook');
    expect(platformOf('group')).toBe('facebook');
    expect(platformOf('bluesky')).toBe('bluesky');
  });

  it('orders platforms and counts rows and problems', () => {
    const groups = groupByPlatform([
      row('mastodon', 'M'),
      row('page', 'B'),
      row('instagram', 'I'),
      row('group', 'A', 'reconnect'),
      row('somethingnew', 'Z'),
    ]);
    expect(groups.map((g) => g.platform)).toEqual(['facebook', 'instagram', 'mastodon', 'somethingnew']);
    expect(groups[0]!.rows.map((r) => r.name)).toEqual(['A', 'B']);
    expect(groups[0]!.problems).toBe(1);
    expect(groups[1]!.problems).toBe(0);
  });

  it('sorts problems first, then workspace, then name', () => {
    const [group] = groupByPlatform([
      row('page', 'b', 'ok', 'Client B'),
      row('page', 'a', 'ok', 'Client B'),
      row('page', 'z', 'paused', 'Client A'),
      row('page', 'y', 'blocked', 'Client C'),
      row('page', 'c', 'ok', 'Client A'),
    ]);
    expect(group!.rows.map((r) => r.name)).toEqual(['y', 'z', 'c', 'a', 'b']);
  });

  it('derives the worst status', () => {
    expect(connectionStatus({ accountInvalid: true, orphan: false, enabled: true, canPublish: true })).toBe('reconnect');
    expect(connectionStatus({ accountInvalid: false, orphan: true, enabled: true, canPublish: true })).toBe('reconnect');
    expect(connectionStatus({ accountInvalid: false, orphan: false, enabled: true, canPublish: false })).toBe('blocked');
    expect(connectionStatus({ accountInvalid: false, orphan: false, enabled: false, canPublish: true })).toBe('paused');
    expect(connectionStatus({ accountInvalid: false, orphan: false, enabled: true, canPublish: true })).toBe('ok');
  });
});
