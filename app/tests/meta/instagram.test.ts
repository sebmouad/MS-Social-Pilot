// Instagram (Instagram API with Facebook Login) calls behind each Meta permission, against a fake Graph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInstagramAdapter, createInstagramCollector } from '@/platforms/instagram/adapter';
import { INSTAGRAM_POLICY_DEFAULTS } from '@/platforms/instagram/config';
import { fakeGraph } from './fake-graph';

const all = ['instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'instagram_manage_insights', 'pages_read_engagement'];
const credential = (scopes = all) => ({ accessToken: 'PAGE-TOKEN', grantedScopes: scopes });
const adapterWith = (routes: Parameters<typeof fakeGraph>[0]) => {
  const graph = fakeGraph(routes);
  return { adapter: createInstagramAdapter(INSTAGRAM_POLICY_DEFAULTS, { fetch: graph.fetch, appSecret: 'test-secret', wait: async () => {} }), sent: graph.sent, fetch: graph.fetch };
};

test('instagram_content_publish: photo container, wait until FINISHED, media_publish, permalink', async () => {
  let polls = 0;
  const { adapter, sent } = adapterWith([
    { method: 'POST', path: /^\/1789\/media$/, reply: { id: 'C1' } },
    { method: 'GET', path: /^\/C1$/, reply: () => ({ status_code: ++polls < 2 ? 'IN_PROGRESS' : 'FINISHED' }) },
    { method: 'POST', path: /^\/1789\/media_publish$/, reply: { id: 'M1' } },
    { method: 'GET', path: /^\/M1$/, reply: { permalink: 'https://www.instagram.com/p/abc/' } },
  ]);
  const result = await adapter.publish!({ credential: credential(), target: { id: '1789', kind: 'professional' } as never, formatId: 'image', text: 'Autumn soup', media: [{ kind: 'image', url: 'https://cdn.example/soup.jpg' }] as never });
  assert.deepEqual(result, { remoteId: 'M1', url: 'https://www.instagram.com/p/abc/', state: 'published' });
  assert.equal(sent[0]!.body.image_url, 'https://cdn.example/soup.jpg');
  assert.equal(sent[0]!.body.caption, 'Autumn soup');
  assert.equal(sent.find(s => s.path === '/1789/media_publish')!.body.creation_id, 'C1');
  assert.ok(sent.every(s => s.token === 'PAGE-TOKEN' && s.proof));
});

test('instagram_content_publish is required before anything is sent', async () => {
  const { adapter, sent } = adapterWith([]);
  await assert.rejects(adapter.publish!({ credential: credential(['instagram_basic']), target: { id: '1789', kind: 'professional' } as never, formatId: 'image', text: 'x', media: [{ kind: 'image', url: 'https://cdn.example/a.jpg' }] as never }));
  assert.equal(sent.length, 0);
});

test('instagram_manage_comments: reads comments of its own media, replies and hides', async () => {
  const { adapter, sent } = adapterWith([
    { method: 'GET', path: /^\/M1$/, reply: { owner: { id: '1789' } } },
    { method: 'GET', path: /^\/M1\/comments$/, reply: { data: [{ id: 'K1', text: 'Yum!', timestamp: '2026-11-09T10:00:00+0000', from: { id: '55', username: 'visitor' } }] } },
    { method: 'GET', path: /^\/K1\/replies$/, reply: { data: [] } },
    { method: 'POST', path: /^\/K1\/replies$/, reply: { id: 'K2' } },
    { method: 'POST', path: /^\/K1$/, reply: { success: true } },
  ]);
  const comments = await adapter.listComments!({ credential: credential(), targetId: '1789', remotePostId: 'M1' } as never);
  assert.equal(comments.length, 1);
  assert.equal(comments[0]!.authorName, 'visitor');
  assert.deepEqual(await adapter.replyToInbox!({ credential: credential(), targetId: '1789', remoteId: 'K1', text: 'Thank you!' }), { remoteId: 'K2' });
  assert.equal(sent.find(s => s.method === 'POST' && s.path === '/K1/replies')!.body.message, 'Thank you!');
  await adapter.hideInboxItem!({ credential: credential(), targetId: '1789', remoteId: 'K1', hidden: true } as never);
  assert.equal(sent.at(-1)!.body.hide, 'true');
});

test('a comment on someone else\'s media is refused', async () => {
  const { adapter } = adapterWith([{ method: 'GET', path: /^\/M9$/, reply: { owner: { id: '4242' } } }]);
  await assert.rejects(adapter.listComments!({ credential: credential(), targetId: '1789', remotePostId: 'M9' } as never));
});

test('instagram_manage_insights: reads the account metrics, and nothing without the permission', async () => {
  const graph = fakeGraph([{ path: /^\/1789\/insights$/, reply: (s: { query: Record<string, string> }) => ({ data: [{ name: s.query.metric, period: 'day', values: [{ value: 7, end_time: '2026-11-02T08:00:00+0000' }], total_value: { value: 7 } }] }) }]);
  const collector = createInstagramCollector(INSTAGRAM_POLICY_DEFAULTS, { fetch: graph.fetch, appSecret: 'test-secret' });
  const result = await collector.account({ credential: credential(), targetId: '1789', since: new Date('2026-11-01'), until: new Date('2026-11-08') });
  assert.deepEqual(graph.sent.map(s => s.query.metric).sort(), INSTAGRAM_POLICY_DEFAULTS.accountMetrics.map(m => m.name).sort());
  assert.ok(JSON.stringify(result).includes('7'));
  const before = graph.sent.length;
  await assert.rejects(collector.account({ credential: credential(['instagram_basic', 'pages_read_engagement']), targetId: '1789', since: new Date('2026-11-01'), until: new Date('2026-11-08') }));
  assert.equal(graph.sent.length, before, 'nothing sent without instagram_manage_insights');
});
