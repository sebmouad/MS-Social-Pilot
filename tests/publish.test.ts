import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.SESSION_SECRET = 'test-session-secret';
  process.env.FACEBOOK_APP_ID = '123';
  process.env.FACEBOOK_APP_SECRET = 'test-app-secret';
});

const {
  planPublish,
  buildFeedBody,
  buildMediaCaption,
  buildPermalink,
  buildVideoPermalink,
  toScheduledPublishTime,
} = await import(
  '../src/lib/facebook/publish'
);
const { GraphError } = await import('../src/lib/facebook/graph');

const image = (id: string) =>
  ({ kind: 'image', source: { type: 'url', url: `https://cdn.example.com/${id}.jpg` } }) as const;
const video = {
  kind: 'video',
  source: { type: 'url', url: 'https://cdn.example.com/clip.mp4' },
} as const;

function request(overrides: Partial<Parameters<typeof planPublish>[0]> = {}) {
  return {
    targetType: 'page' as const,
    targetId: '1234',
    accessToken: 'token',
    message: 'Hello',
    ...overrides,
  };
}

describe('planPublish', () => {
  it('routes plain text to the feed edge', () => {
    expect(planPublish(request())).toEqual({ strategy: 'feed' });
  });

  it('routes a link-only post to the feed edge', () => {
    expect(planPublish(request({ message: '', link: 'https://example.com' }))).toEqual({
      strategy: 'feed',
    });
  });

  it('routes a single photo to the photos edge', () => {
    expect(planPublish(request({ media: [image('a')] }))).toEqual({ strategy: 'single_photo' });
  });

  it('routes several photos to the multi-photo flow', () => {
    expect(planPublish(request({ media: [image('a'), image('b'), image('c')] }))).toEqual({
      strategy: 'multi_photo',
      count: 3,
    });
  });

  it('routes a video to the videos edge', () => {
    expect(planPublish(request({ media: [video] }))).toEqual({ strategy: 'video' });
  });

  it('rejects mixing a video with photos', () => {
    expect(() => planPublish(request({ media: [video, image('a')] }))).toThrow(/cannot mix/i);
  });

  it('rejects more than one video', () => {
    expect(() => planPublish(request({ media: [video, video] }))).toThrow(/at most one video/i);
  });

  it('rejects an entirely empty post', () => {
    expect(() => planPublish(request({ message: '   ', link: null, media: [] }))).toThrow(
      /text, a link, or media/i,
    );
  });
});

describe('buildFeedBody', () => {
  it('tags a place when one is given, and leaves the field out otherwise', () => {
    expect(buildFeedBody({ message: 'Hi', place: '1234567890' })).toMatchObject({ message: 'Hi', place: '1234567890' });
    expect(buildFeedBody({ message: 'Hi', place: null })).not.toHaveProperty('place');
  });

  it('includes the message and link', () => {
    expect(buildFeedBody({ message: 'Hi', link: 'https://example.com' })).toEqual({
      message: 'Hi',
      link: 'https://example.com',
    });
  });

  it('omits a whitespace-only message', () => {
    const body = buildFeedBody({ message: '   ', link: 'https://example.com' });
    expect(body).not.toHaveProperty('message');
  });

  it('indexes attached media the way Graph expects', () => {
    const body = buildFeedBody({ message: 'Gallery', attachedMediaIds: ['111', '222'] });
    expect(body['attached_media[0]']).toEqual({ media_fbid: '111' });
    expect(body['attached_media[1]']).toEqual({ media_fbid: '222' });
  });

  it('marks a natively scheduled post unpublished with a unix timestamp', () => {
    const now = new Date('2026-03-01T10:00:00Z');
    const when = new Date('2026-03-01T12:00:00Z');

    const body = buildFeedBody({ message: 'Later', scheduledPublishTime: when, now });
    expect(body.published).toBe(false);
    expect(body.scheduled_publish_time).toBe(Math.floor(when.getTime() / 1000));
  });
});

describe('toScheduledPublishTime', () => {
  const now = new Date('2026-03-01T10:00:00Z');

  it('accepts a time comfortably in the future', () => {
    const when = new Date('2026-03-01T11:00:00Z');
    expect(toScheduledPublishTime(when, now)).toBe(Math.floor(when.getTime() / 1000));
  });

  it("rejects a time inside Facebook's 10-minute floor", () => {
    expect(() => toScheduledPublishTime(new Date('2026-03-01T10:05:00Z'), now)).toThrow(
      /at least 10 minutes/i,
    );
  });

  it('rejects a time beyond the 30-day ceiling', () => {
    // Meta's limit is 30 days; it used to say six months here.
    expect(() => toScheduledPublishTime(new Date('2026-04-15T10:00:00Z'), now)).toThrow(
      /more than 30 days/i,
    );
    expect(() => toScheduledPublishTime(new Date('2026-03-30T10:00:00Z'), now)).not.toThrow();
  });

  it('throws a GraphError so route handlers map it to a 400', () => {
    expect(() => toScheduledPublishTime(new Date('2026-03-01T10:01:00Z'), now)).toThrow(GraphError);
  });
});

describe('buildPermalink', () => {
  it('builds a page permalink from a compound id', () => {
    expect(buildPermalink('page', '1234', '1234_5678')).toBe('https://www.facebook.com/1234/posts/5678/');
  });

  it('builds a group permalink', () => {
    expect(buildPermalink('group', '999', '999_111')).toBe(
      'https://www.facebook.com/groups/999/posts/111/',
    );
  });

  it('handles a bare id, as returned by the photos edge', () => {
    expect(buildPermalink('page', '1234', '5678')).toBe('https://www.facebook.com/1234/posts/5678/');
  });
});

describe('buildMediaCaption', () => {
  it('appends the link to the text', () => {
    expect(buildMediaCaption('Hi', 'https://example.com/?utm_source=fb')).toBe(
      'Hi\n\nhttps://example.com/?utm_source=fb',
    );
  });

  it('does not repeat a link already in the text', () => {
    expect(buildMediaCaption('Read https://example.com now', 'https://example.com')).toBe(
      'Read https://example.com now',
    );
  });

  it('uses the link alone when there is no text', () => {
    expect(buildMediaCaption('   ', 'https://example.com')).toBe('https://example.com');
  });

  it('leaves the text alone without a link', () => {
    expect(buildMediaCaption('Hi', null)).toBe('Hi');
    expect(buildMediaCaption('  ', undefined)).toBe('');
  });
});

describe('buildVideoPermalink', () => {
  it('uses the Page videos path', () => {
    expect(buildVideoPermalink('page', '1234', '5678')).toBe('https://www.facebook.com/1234/videos/5678/');
  });

  it('uses the bare video id for a group, which has no videos path', () => {
    expect(buildVideoPermalink('group', '999', '5678')).toBe('https://www.facebook.com/5678');
  });
});
