import { describe, expect, it } from 'vitest';

import { businessMs, commentWaits, median, messageWaits, summariseWaits } from '../src/lib/response-time';

const at = (iso: string) => new Date(iso);
const MIN = 60_000;
const HOUR = 60 * MIN;
const weekdays = { days: [1, 2, 3, 4, 5], start: 9, end: 18 };

describe('business hours', () => {
  it('counts every hour when none are set', () => {
    expect(businessMs(at('2026-11-02T22:00:00Z'), at('2026-11-03T09:05:00Z'), null, 'UTC')).toBe(11 * HOUR + 5 * MIN);
  });

  it('counts only open hours, across a night and a weekend', () => {
    // Monday 23:00 to Tuesday 09:05: five minutes.
    expect(businessMs(at('2026-11-02T23:00:00Z'), at('2026-11-03T09:05:00Z'), weekdays, 'UTC')).toBe(5 * MIN);
    // Friday 17:00 to Monday 10:00: one hour Friday, one Monday.
    expect(businessMs(at('2026-11-06T17:00:00Z'), at('2026-11-09T10:00:00Z'), weekdays, 'UTC')).toBe(2 * HOUR);
  });

  it('reads the hours on the workspace’s clock', () => {
    // 09:00 in Tokyo is 00:00 UTC.
    expect(businessMs(at('2026-11-02T23:30:00Z'), at('2026-11-03T00:30:00Z'), weekdays, 'Asia/Tokyo')).toBe(30 * MIN);
  });
});

describe('waits', () => {
  it('pairs a comment with the Page’s first reply under it', () => {
    const waits = commentWaits(
      [
        { remoteId: 'c1', parentRemoteId: null, fromId: 'fan', createdTime: at('2026-11-02T10:00:00Z'), resolvedAt: null, sentById: null },
        { remoteId: 'r2', parentRemoteId: 'c1', fromId: 'page', createdTime: at('2026-11-02T11:00:00Z'), resolvedAt: null, sentById: 'u2' },
        { remoteId: 'r1', parentRemoteId: 'c1', fromId: 'page', createdTime: at('2026-11-02T10:20:00Z'), resolvedAt: null, sentById: 'u1' },
        { remoteId: 'c2', parentRemoteId: null, fromId: 'fan', createdTime: at('2026-11-02T12:00:00Z'), resolvedAt: at('2026-11-02T13:00:00Z'), sentById: null },
        { remoteId: 'c3', parentRemoteId: null, fromId: 'page', createdTime: at('2026-11-02T12:00:00Z'), resolvedAt: null, sentById: null },
      ],
      'page',
    );
    expect(waits).toEqual([
      { startedAt: at('2026-11-02T10:00:00Z'), answeredAt: at('2026-11-02T10:20:00Z'), answeredBy: 'u1', resolvedAt: null },
      { startedAt: at('2026-11-02T12:00:00Z'), answeredAt: null, answeredBy: null, resolvedAt: at('2026-11-02T13:00:00Z') },
    ]);
  });

  it('starts a message wait at the first of a run and ends it at the Page’s answer', () => {
    const waits = messageWaits(
      [
        { fromId: 'fan', createdTime: at('2026-11-02T10:00:00Z'), sentById: null },
        { fromId: 'fan', createdTime: at('2026-11-02T10:05:00Z'), sentById: null },
        { fromId: 'page', createdTime: at('2026-11-02T10:30:00Z'), sentById: 'u1' },
        { fromId: 'fan', createdTime: at('2026-11-02T12:00:00Z'), sentById: null },
      ],
      'page',
      at('2026-11-02T12:10:00Z'),
    );
    expect(waits).toEqual([
      { startedAt: at('2026-11-02T10:00:00Z'), answeredAt: at('2026-11-02T10:30:00Z'), answeredBy: 'u1', resolvedAt: null },
      { startedAt: at('2026-11-02T12:00:00Z'), answeredAt: null, answeredBy: null, resolvedAt: at('2026-11-02T12:10:00Z') },
    ]);
  });

  it('summarises with medians and the slowest', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBeNull();
    const summary = summariseWaits(
      [
        { startedAt: at('2026-11-02T10:00:00Z'), answeredAt: at('2026-11-02T10:10:00Z'), answeredBy: null, resolvedAt: at('2026-11-02T11:00:00Z') },
        { startedAt: at('2026-11-02T10:00:00Z'), answeredAt: at('2026-11-02T12:00:00Z'), answeredBy: null, resolvedAt: null },
        { startedAt: at('2026-11-02T10:00:00Z'), answeredAt: null, answeredBy: null, resolvedAt: null },
      ],
      null,
      'UTC',
    );
    expect(summary).toEqual({ total: 3, answered: 2, medianFirstMs: 65 * MIN, slowestFirstMs: 2 * HOUR, resolved: 1, medianResolveMs: HOUR });
  });
});
