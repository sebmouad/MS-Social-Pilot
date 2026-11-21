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
