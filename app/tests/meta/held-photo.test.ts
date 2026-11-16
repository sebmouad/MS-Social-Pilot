// A post Facebook holds as a photo (2026-11-16): stored by its photo id, read and moved through its feed post.
// Without this, cancelling or moving any held photo post was refused (« the platform did not confirm it still holds it »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '@/server/platforms/registry';
import { createFacebookEngine } from '@/platforms/facebook/publishing';
import { heldContentKind } from '@/modules/publishing/server/remote-hold';
import { fakeGraph, facebookConfig } from './fake-graph';

const later = Math.floor(Date.now() / 1000) + 86_400;
const routes = (published: boolean) => [
  { method: 'GET', path: /^\/photo1$/, reply: { id: 'photo1', from: { id: 'page1' }, created_time: '2026-11-16T10:00:00+0000', page_story_id: 'page1_story1' } },
  { method: 'GET', path: /^\/page1_story1$/, reply: { id: 'page1_story1', is_published: published, scheduled_publish_time: later } },
  { method: 'POST', path: /^\/page1_story1$/, reply: { success: true } },
];

test('held photo: the content kind comes from the post media', () => {
  assert.equal(heldContentKind([{ kind: 'image', url: 'media:x' }]), 'image');
  assert.equal(heldContentKind([{ kind: 'video', url: 'media:y' }]), 'video');
  assert.equal(heldContentKind([]), 'text');
});

test('held photo: read as scheduled when the reader knows it is a photo', async () => {
  const graph = fakeGraph(routes(false));
  const engine = createFacebookEngine(facebookConfig as never, graph.fetch);
  const status = await engine.getStatus('token', 'photo1', { targetId: 'page1', contentKind: 'image' });
  assert.equal(status.state, 'scheduled');
});

test('held photo: a new time is set on its feed post, never on the photo id', async () => {
  const graph = fakeGraph(routes(false));
  const engine = createFacebookEngine(facebookConfig as never, graph.fetch);
  await engine.rescheduleScheduledPost('token', 'photo1', later + 3600);
  const post = graph.sent.find(sent => sent.method === 'POST');
  assert.equal(post?.path, '/page1_story1');
  assert.equal(post?.body.scheduled_publish_time, String(later + 3600));
});

test('held photo: once live it is never moved', async () => {
  const graph = fakeGraph(routes(true));
  const engine = createFacebookEngine(facebookConfig as never, graph.fetch);
  await assert.rejects(engine.rescheduleScheduledPost('token', 'photo1', later + 3600), /no longer holds/);
  assert.ok(!graph.sent.some(sent => sent.method === 'POST'));
});
