// Posts deleted on Facebook (2026-11-21): recognised from Graph's answer and from the Page webhook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMissingPostError } from '@/platforms/facebook/remote-missing';
import { FacebookApiError } from '@/platforms/facebook/publishing';
import { parseMetaWebhookPayload } from '@/platforms/facebook/webhooks';

test('a Graph « object does not exist » answer (100/33) is a deleted post; other errors are not', () => {
  const error = (code: number, subcode?: number) => Object.assign(Object.create(FacebookApiError.prototype) as FacebookApiError, { code, subcode });
  assert.equal(isMissingPostError(error(100, 33)), true);
  assert.equal(isMissingPostError(error(100)), false);
  assert.equal(isMissingPostError(error(190, 33)), false);
  assert.equal(isMissingPostError(new Error('x')), false);
});

test('a feed webhook removing a post carries the post and the « remove » verb', () => {
  const [event] = parseMetaWebhookPayload({ object: 'page', entry: [{ id: '123', time: 1, changes: [{ field: 'feed', value: { item: 'post', verb: 'remove', post_id: '123_456', created_time: 1763750000 } }] }] });
  assert.equal(event?.kind, 'feed_post');
  assert.equal(event?.verb, 'remove');
  assert.equal(event?.postId, '123_456');
});

test('one post, two ids: the post part is the same whatever the Page or profile prefix', async () => {
  const { postPart } = await import('@/platforms/facebook/remote-missing');
  assert.equal(postPart('480386571820832_122194441490614220'), '122194441490614220');
  assert.equal(postPart('122193628256614220_122194441490614220'), '122194441490614220');
  assert.equal(postPart('122194441490614220'), '122194441490614220');
});

test('reach at a fixed age: read at 2–5 h and 22–30 h only, from media views else reach', async () => {
  const { reachAtAge } = await import('@/platforms/facebook/remote-missing');
  const now = new Date('2026-11-22T15:15:00Z'); const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);
  assert.deepEqual(reachAtAge({ post_total_media_view_unique: 812.4, reach: 5 }, ago(3), now), { reach3h: 812, reach24h: null });
  assert.deepEqual(reachAtAge({ reach: 9000 }, ago(25), now), { reach3h: null, reach24h: 9000 });
  assert.deepEqual(reachAtAge({ reach: 9000 }, ago(12), now), { reach3h: null, reach24h: null });
  assert.deepEqual(reachAtAge(null, ago(3), now), { reach3h: null, reach24h: null });
});
