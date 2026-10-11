import { describe, expect, it } from 'vitest';

import { planPublish } from '../src/lib/facebook/publish';
import { awarenessOn } from '../src/lib/awareness-days';
import { weekGrid } from '../src/lib/time';
import { nextReportRun, reportPeriod } from '../src/lib/report-schedules';
import { comparisonWindow, parseCompare } from '../src/lib/date-range';

/** Reels, Stories, the calendar's week and awareness days, and report timing. */

const image = { kind: 'image', source: { type: 'url', url: 'https://cdn.example.com/a.jpg' } } as const;
const video = { kind: 'video', source: { type: 'url', url: 'https://cdn.example.com/clip.mp4' } } as const;
const request = (overrides: Partial<Parameters<typeof planPublish>[0]> = {}) => ({
  targetType: 'page' as const,
  targetId: '1234',
  accessToken: 'token',
  message: 'Hello',
  ...overrides,
});

describe('Reels and Stories', () => {
  it('send a Reel through the Reels flow, and only with one video', () => {
    expect(planPublish(request({ format: 'reel', media: [video] }))).toEqual({ strategy: 'reel' });
    expect(() => planPublish(request({ format: 'reel', media: [image] }))).toThrow(/exactly one video/);
    expect(() => planPublish(request({ format: 'reel' }))).toThrow(/exactly one video/);
  });

  it('send a Story as a photo or a video story, with one item', () => {
    expect(planPublish(request({ format: 'story', media: [image] }))).toEqual({ strategy: 'story_photo' });
    expect(planPublish(request({ format: 'story', media: [video] }))).toEqual({ strategy: 'story_video' });
    expect(() => planPublish(request({ format: 'story', media: [image, image] }))).toThrow(/one photo or one video/);
  });

  it('refuse Groups and Facebook-held scheduling', () => {
    expect(() => planPublish(request({ format: 'reel', media: [video], targetType: 'group' }))).toThrow(/Facebook Page/);
    expect(() =>
      planPublish(request({ format: 'story', media: [image], scheduledPublishTime: new Date('2030-01-01') })),
    ).toThrow(/cannot hold/);
  });
});

describe('the calendar', () => {
  it('lays a week out Monday first, whatever day it is asked from', () => {
    const days = weekGrid('2026-10-08', 'Africa/Casablanca').map((day) => day.toISOString());
    expect(days).toHaveLength(7);
    // Casablanca is UTC+1 in October: midnight there is 23:00 the day before.
    expect(days[0]).toBe('2026-10-04T23:00:00.000Z');
    expect(days[6]).toBe('2026-10-10T23:00:00.000Z');
  });

  it('marks fixed awareness days and the moving Black Friday', () => {
    expect(awarenessOn('2026-02-14').map((day) => day.key)).toContain('valentines');
    expect(awarenessOn('2026-11-27').map((day) => day.key)).toContain('blackFriday');
    expect(awarenessOn('2027-11-26').map((day) => day.key)).toContain('blackFriday');
    expect(awarenessOn('2026-11-28').map((day) => day.key)).not.toContain('blackFriday');
  });
});

describe('scheduled reports', () => {
  it('go out on the next Monday or the next 1st, at eight in the workspace’s zone', () => {
    // Sunday 11 October 2026, noon UTC.
    const at = new Date('2026-10-11T12:00:00Z');
    expect(nextReportRun('weekly', at, 'UTC').toISOString()).toBe('2026-10-12T08:00:00.000Z');
    expect(nextReportRun('monthly', at, 'UTC').toISOString()).toBe('2026-11-01T08:00:00.000Z');
    expect(nextReportRun('weekly', at, 'Africa/Casablanca').toISOString()).toBe('2026-10-12T07:00:00.000Z');
  });

  it('never fire twice for the same morning', () => {
    const run = new Date('2026-10-12T08:00:00Z');
    expect(nextReportRun('weekly', run, 'UTC').toISOString()).toBe('2026-10-19T08:00:00.000Z');
  });

  it('cover the whole week or month before the run', () => {
    const week = reportPeriod('weekly', new Date('2026-10-12T08:00:00Z'), 'UTC');
    expect([week.fromDay, week.toDay]).toEqual(['2026-10-05', '2026-10-11']);
    expect(week.from.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    const month = reportPeriod('monthly', new Date('2026-01-01T08:00:00Z'), 'UTC');
    expect([month.fromDay, month.toDay]).toEqual(['2025-12-01', '2025-12-31']);
  });
});

describe('the comparison period', () => {
  const from = new Date('2026-09-11T00:00:00Z');
  const to = new Date('2026-10-11T00:00:00Z');

  it('is the same length just before, by default', () => {
    expect(parseCompare(undefined)).toBe('previous');
    const before = comparisonWindow(from, to, 'previous');
    expect(before.from.toISOString()).toBe('2026-08-12T00:00:00.000Z');
    expect(before.to.toISOString()).toBe(from.toISOString());
  });

  it('can be the same dates a year earlier', () => {
    expect(parseCompare('year')).toBe('year');
    expect(parseCompare('nonsense')).toBe('previous');
    const before = comparisonWindow(from, to, 'year');
    expect(before.from.toISOString()).toBe('2025-09-11T00:00:00.000Z');
    expect(before.to.toISOString()).toBe('2025-10-11T00:00:00.000Z');
  });
});

describe('AI output, made safe', () => {
  it('keeps real hashtags once each', async () => {
    const { parseHashtags } = await import('../src/lib/ai');
    expect(parseHashtags('#Paris\n#paris #Café_Lumière, and #x\n- #Brunch')).toEqual(['#Paris', '#Café_Lumière', '#Brunch']);
  });

  it('reads a plan with days in range and real times, even wrapped in prose', async () => {
    const { parsePlan } = await import('../src/lib/ai');
    const text = 'Here you go:\n[{"day":0,"time":"9:30","text":"Hi"},{"day":12,"time":"25:99","text":"Late"},{"day":2,"text":""}]';
    expect(parsePlan(text, 7, 5)).toEqual([
      { day: 0, time: '09:30', text: 'Hi' },
      { day: 6, time: '23:59', text: 'Late' },
    ]);
    expect(parsePlan('no json here', 7, 5)).toEqual([]);
  });
});
