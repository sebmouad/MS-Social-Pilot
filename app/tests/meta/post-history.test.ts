// Post history reads a Page's posts in batches within a time window. When the window runs out, the posts already
// read are kept and the saved position only moves past complete batches (2026-11-15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFacebookPostHistory } from '@/platforms/facebook/post-history';
import { fakeGraph, facebookConfig } from './fake-graph';

const now = new Date('2026-11-15T12:00:00Z');
const policy = { lookbackDays: 30, pageBudget: 3, edge: 'published_posts' as const, fields: ['id', 'created_time', 'message'], metrics: [], reactionTypes: [] };
const post = (id: string) => ({ id, created_time: '2026-11-10T10:00:00+0000', message: `Post ${id}` });
const batches: Record<string, { data: unknown[]; paging?: unknown }> = {
  '': { data: [post('p1'), post('p2')], paging: { cursors: { after: 'c1' }, next: 'https://graph.facebook.com/next1' } },
  c1: { data: [post('p3'), post('p4')], paging: { cursors: { after: 'c2' }, next: 'https://graph.facebook.com/next2' } },
  c2: { data: [post('p5')] },
};

/** A fake Graph that aborts the window when the given post's insights are requested. */
function graphAbortingAt(postId: string | null) {
  const controller = new AbortController();
  const graph = fakeGraph([
    { path: /^\/page1\/published_posts$/, reply: sent => batches[sent.query.after ?? ''] },
    { path: /^\/p\d\/insights$/, reply: sent => { if (postId && sent.path === `/${postId}/insights`) controller.abort(); return { data: [] }; } },
  ]);
  return { history: createFacebookPostHistory(facebookConfig, policy, graph.fetch, controller.signal) };
}

test('post history: a complete read walks every batch and finishes', async () => {
  const { history } = graphAbortingAt(null);
  const result = await history.collect('page-token', 'page1', now);
  assert.deepEqual(result.posts.map(item => item.remoteId), ['p1', 'p2', 'p3', 'p4', 'p5']);
  assert.equal(result.progress.complete, true);
  assert.equal(result.cutShort, false);
});

test('post history: when the window runs out in the second batch, the first batch is kept and the cursor stays after it', async () => {
  const { history } = graphAbortingAt('p3');
  const result = await history.collect('page-token', 'page1', now);
  assert.equal(result.cutShort, true);
  assert.deepEqual(result.posts.map(item => item.remoteId).filter(id => ['p1', 'p2'].includes(id)), ['p1', 'p2']);
  assert.ok(!result.posts.some(item => item.remoteId === 'p5'));
  assert.equal(result.progress.after, 'c1');
  assert.equal(result.progress.complete, false);
});

test('post history: when the window runs out in the first batch, finished posts are kept and the cursor does not move', async () => {
  const { history } = graphAbortingAt('p2');
  const result = await history.collect('page-token', 'page1', now);
  assert.equal(result.cutShort, true);
  assert.equal(result.progress.after, null);
  assert.ok(result.posts.length <= 2);
  assert.ok(!result.posts.some(item => ['p3', 'p4', 'p5'].includes(item.remoteId)));
});
