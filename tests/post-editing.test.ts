import { describe, expect, it } from 'vitest';

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
