import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import en from '../messages/en.json';
import fr from '../messages/fr.json';

import { postIsEditable, postEditBlocker } from '../src/lib/constants';

/**
 * Whether a post can still be changed.
 *
 * The rule lives in one function because two very different callers ask it:
 * `updatePost` refuses the save, and the post list decides whether to show an
 * Edit button at all. When those disagree the user gets a button that leads to
 * a 409, which is worse than no button — so the point of these tests is that
 * the one answer covers every case both callers can see.
 */

const nothingSent = [{ status: 'pending' }, { status: 'pending' }];

describe('a post that has not gone out', () => {
  it('can be edited while it is a draft, scheduled, or waiting for review', () => {
    for (const status of ['draft', 'scheduled', 'pending_approval', 'rejected']) {
      expect(postIsEditable({ status, targets: nothingSent }), status).toBe(true);
    }
  });

  it('can still be edited after a failure, which is usually why someone is here', () => {
    expect(
      postIsEditable({ status: 'failed', targets: [{ status: 'failed' }] }),
    ).toBe(true);
  });

  it('can be edited after being cancelled, which is how a cancellation is undone', () => {
    expect(postIsEditable({ status: 'cancelled', targets: [{ status: 'cancelled' }] })).toBe(true);
  });
});

describe('a post that is on its way out, or gone', () => {
  it('cannot be edited mid-publish', () => {
    expect(postEditBlocker({ status: 'publishing', targets: nothingSent })).toBe('publishing');
  });

  it('cannot be edited once published', () => {
    expect(postEditBlocker({ status: 'published', targets: [{ status: 'published' }] })).toBe(
      'published',
    );
  });

  it('cannot be edited when only some destinations succeeded', () => {
    // The successful ones are on Facebook and cannot be taken back, so editing
    // the text would leave two versions of the same post in the world.
    expect(
      postEditBlocker({
        status: 'partially_failed',
        targets: [{ status: 'published' }, { status: 'failed' }],
      }),
    ).toBe('published');
  });

  it('cannot be edited once Facebook is holding it', () => {
    // Natively scheduled: our copy is no longer the one that goes out, so a
    // save here would change nothing while looking like it worked.
    expect(
      postEditBlocker({
        status: 'scheduled',
        targets: [{ status: 'pending' }, { status: 'scheduled_remote' }],
      }),
    ).toBe('scheduled_remote');
  });

  it('reports the reason nearest the top, so the message names the real obstacle', () => {
    // Publishing *and* handed to Facebook: "being published right now" is the
    // one that will still be true a second later.
    expect(
      postEditBlocker({ status: 'publishing', targets: [{ status: 'scheduled_remote' }] }),
    ).toBe('publishing');
  });
});

describe('the two answers', () => {
  it('agree: anything with a blocker cannot be edited', () => {
    const cases = [
      { status: 'draft', targets: nothingSent },
      { status: 'publishing', targets: nothingSent },
      { status: 'published', targets: [{ status: 'published' }] },
      { status: 'partially_failed', targets: [{ status: 'published' }] },
      { status: 'scheduled', targets: [{ status: 'scheduled_remote' }] },
      { status: 'failed', targets: [{ status: 'failed' }] },
    ];

    for (const post of cases) {
      expect(postIsEditable(post), post.status).toBe(postEditBlocker(post) === null);
    }
  });
});

describe('naming a destination', () => {
  it('has a catalogue key for every kind there is', async () => {
    const { targetTypeKey, TARGET_TYPES } = await import('../src/lib/constants');
    const messages = (await import('../messages/en.json')).default as unknown as {
      targets: Record<string, string>;
    };

    // A new TargetType with no copy would render as "Page" on two screens,
    // which is how Instagram was first labelled.
    for (const type of TARGET_TYPES) {
      expect(targetTypeKey(type), type).toBe(type);
      expect(messages.targets[type], `no targets.${type} copy`).toBeTypeOf('string');
    }
  });

  it('falls back rather than throwing inside a render', async () => {
    const { targetTypeKey } = await import('../src/lib/constants');

    expect(targetTypeKey('something-new')).toBe('page');
  });
});

describe('a post with a destination in flight', () => {
  it('cannot be edited, even while the post itself still reads scheduled', () => {
    // The window this exists for: a worker has claimed one destination and no
    // outcome has come back, so the post row is still `scheduled` and nothing
    // at the post level says anything is happening.
    expect(
      postEditBlocker({
        status: 'scheduled',
        targets: [{ status: 'processing' }, { status: 'pending' }],
      }),
    ).toBe('publishing');
  });

  it('is editable again once the claim has resolved', () => {
    // Only the states that legitimately sit under a `scheduled` post. A
    // published destination puts the post itself into `publishing`, which the
    // check above already refuses — asserting anything about that combination
    // here would be describing a state the app cannot produce.
    for (const status of ['pending', 'failed', 'cancelled']) {
      expect(
        postIsEditable({ status: 'scheduled', targets: [{ status }] }),
        status,
      ).toBe(true);
    }
  });
});

/**
 * What the composer says after a queued post is saved.
 *
 * The queue picks the time on the server, so the response is the only place
 * the author can learn which slot they got. Falling back to the generic
 * "Scheduled" leaves them to go and find out on the calendar.
 */
describe('the confirmation for a queued post', () => {
  const source = readFileSync('src/components/Composer.tsx', 'utf8');

  it('reads the time the server picked', () => {
    expect(source).toContain('body.scheduledAt');
    expect(source).toMatch(/t\('queuedOk', \{ when/);
  });

  it('names the hour, not just the day', () => {
    // `formatInZone` defaults to a pattern carrying the time; a date-only
    // format would tell somebody their post goes out "on Tuesday" and leave
    // the part they actually need out of it.
    const start = source.indexOf('const queuedFor');
    const call = source.slice(start, source.indexOf('setResult(', start));
    expect(call).toContain('formatInZone(');

    // Either no explicit pattern — the default carries the time — or one that
    // names an hour. A date-only format would tell somebody their post goes
    // out "on Tuesday" and leave out the part they actually need.
    const pattern = call.match(/formatInZone\([\s\S]*?,\s*timezone\s*,\s*'([^']*)'/)?.[1];
    expect(pattern === undefined || /[Hh]/.test(pattern), `pattern: ${pattern}`).toBe(true);
  });

  it('is offered in both languages, with the time in it', () => {
    for (const [language, messages] of [['en', en], ['fr', fr]] as const) {
      const compose = messages.compose as Record<string, string>;
      expect(compose.queuedOk, language).toContain('{when}');
      expect(compose.queuedOk, language).not.toBe(compose.scheduledOk);
    }
  });
});

/**
 * What the composer offers after a post has actually gone out.
 *
 * Graph hands back a permalink with every successful publish and the API
 * passes it through. Right after posting is exactly when somebody wants to
 * look at what went out, so telling them it worked and making them go and find
 * it is the wrong half of the answer.
 */
describe('the confirmation for a post that has published', () => {
  const source = readFileSync('src/components/Composer.tsx', 'utf8');

  it('keeps the permalink the API returned', () => {
    // The response type used to declare only name, status and error, so the
    // url was dropped before anything could render it.
    expect(source).toMatch(/results\?: Array<\{[^}]*url\?: string/);
  });

  it('offers a link only for destinations that actually published', () => {
    const blockStart = source.indexOf('setPublished(');
    const block = source.slice(blockStart, source.indexOf('const queuedFor', blockStart));
    expect(block).toContain("item.status === 'published'");
    expect(block).toContain('item.url');
  });

  it('renders them through the guarded link component', () => {
    // A permalink is data from Graph, so it goes through the same check as
    // every other external href rather than straight into an anchor.
    expect(source).toContain("import { ExternalLink } from './ExternalLink'");
    const bannerStart = source.indexOf('{result && (');
    const banner = source.slice(bannerStart, source.indexOf('<div className="flex gap-2">', bannerStart));
    expect(banner).toContain('<ExternalLink');
    expect(banner).not.toMatch(/<a\s+href=\{/);
  });

  it('clears the previous links when a new submit starts', () => {
    // Otherwise a failed second attempt still shows the first post's links,
    // which reads as though the failed one went out too.
    const submitStart = source.indexOf('async function submit(');
    const submit = source.slice(submitStart, source.indexOf('const publishMode =', submitStart));
    expect(submit).toContain('setPublished([])');
  });

  it('names the destination in both languages', () => {
    for (const [language, messages] of [['en', en], ['fr', fr]] as const) {
      const compose = messages.compose as Record<string, string>;
      expect(compose.viewOn, language).toContain('{destination}');
    }
  });
});
