// Every Facebook Graph call behind a Meta permission, checked against a fake Graph: the endpoint, the method,
// the parameters, the Page or user token, the appsecret_proof, and how the answer is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFacebookEngine } from '@/platforms/facebook/publishing';
import { fakeGraph, facebookConfig } from './fake-graph';

const engineWith = (routes: Parameters<typeof fakeGraph>[0]) => { const graph = fakeGraph(routes); return { engine: createFacebookEngine(facebookConfig, graph.fetch), sent: graph.sent }; };

test('login dialog asks for the scopes it is given', () => {
  const { engine } = engineWith([]);
  const url = new URL(engine.getAuthorizationUrl({ appId: '123', redirectUri: 'https://social.example/api/connections/facebook/callback', state: 'st', scopes: ['pages_show_list', 'pages_manage_posts'] }));
  assert.equal(url.origin + url.pathname, 'https://www.facebook.com/v25.0/dialog/oauth');
  assert.equal(url.searchParams.get('scope'), 'pages_show_list,pages_manage_posts');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'st');
});

test('Facebook Login for Business: a configuration ID replaces the scope list', () => {
  const { engine } = engineWith([]);
  const url = new URL(engine.getAuthorizationUrl({ appId: '123', redirectUri: 'https://social.example/cb', state: 'st', scopes: ['pages_show_list'], configId: '987654321' }));
  assert.equal(url.searchParams.get('config_id'), '987654321');
  assert.equal(url.searchParams.has('scope'), false);
});

test('pages_show_list: lists the Pages with their own Page tokens', async () => {
  const { engine, sent } = engineWith([{ path: /^\/me\/accounts$/, reply: { data: [{ id: '111', name: 'Test Page', category: 'Food', access_token: 'PAGE-TOKEN' }] } }]);
  const pages = await engine.discoverPages('USER-TOKEN');
  assert.deepEqual(pages, [{ id: '111', name: 'Test Page', category: 'Food', accessToken: 'PAGE-TOKEN' }]);
  assert.equal(sent[0]!.token, 'USER-TOKEN');
  assert.ok(sent[0]!.proof, 'signed with appsecret_proof');
  assert.match(sent[0]!.query.fields!, /access_token/);
});

test('pages_manage_metadata: subscribes the app to the Page webhooks with the Page token', async () => {
  const { engine, sent } = engineWith([{ method: 'POST', path: /^\/111\/subscribed_apps$/, reply: { success: true } }]);
  await engine.subscribePageWebhooks({ id: '111', accessToken: 'PAGE-TOKEN' }, ['feed', 'messages']);
  assert.equal(sent[0]!.method, 'POST');
  assert.equal(sent[0]!.body.subscribed_fields, 'feed,messages');
  assert.equal(sent[0]!.token, 'PAGE-TOKEN');
  await assert.rejects(engine.subscribePageWebhooks({ id: '../me', accessToken: 'x' }, ['feed']));
});

test('pages_manage_posts: publishes a text post to the Page feed and deletes it', async () => {
  const { engine, sent } = engineWith([
    { method: 'POST', path: /^\/111\/feed$/, reply: { id: '111_222' } },
    { method: 'DELETE', path: /^\/111_222$/, reply: { success: true } },
  ]);
  const published = await engine.publish({ accessToken: 'PAGE-TOKEN', targetId: '111', text: 'Hello from the test' } as never);
  assert.equal((published as { remoteId?: string }).remoteId ?? (published as { id?: string }).id, '111_222');
  assert.equal(sent[0]!.body.message, 'Hello from the test');
  assert.equal(sent[0]!.token, 'PAGE-TOKEN');
  await engine.deletePost('PAGE-TOKEN', '111_222');
  assert.equal(sent.at(-1)!.method, 'DELETE');
});

test('pages_read_user_content: reads visitors comments with their author', async () => {
  const { engine, sent } = engineWith([{ path: /^\/111_222\/comments$/, reply: { data: [{ id: '222_1', message: 'Lovely recipe', from: { id: '900', name: 'Visitor' }, created_time: '2026-11-09T10:00:00+0000' }] } }]);
  const comments = await engine.listComments('PAGE-TOKEN', '111_222');
  const items = Array.isArray(comments) ? comments : (comments as { items: unknown[] }).items;
  assert.equal(items.length, 1);
  assert.match(JSON.stringify(items[0]), /Lovely recipe/);
  assert.match(sent[0]!.query.fields!, /from\{id,name\}/);
});

test('pages_manage_engagement: replies to and hides a comment as the Page', async () => {
  const { engine, sent } = engineWith([
    { method: 'POST', path: /^\/222_1\/comments$/, reply: { id: '222_1_9' } },
    { method: 'POST', path: /^\/222_1$/, reply: { success: true } },
  ]);
  assert.equal(await engine.replyToComment('PAGE-TOKEN', '222_1', 'Thank you!'), '222_1_9');
  assert.equal(sent[0]!.body.message, 'Thank you!');
  await engine.moderateComment('PAGE-TOKEN', '222_1', true);
  assert.equal(sent[1]!.body.is_hidden, 'true');
});

test('pages_messaging: reads conversations and replies through the Send API', async () => {
  const { engine, sent } = engineWith([
    { path: /^\/111\/conversations$/, reply: { data: [{ id: 't_1', snippet: 'Hi', updated_time: '2026-11-09T10:00:00+0000', messages: { data: [{ id: 'm_1', message: 'Hi', created_time: '2026-11-09T10:00:00+0000', from: { id: '900', name: 'Visitor' } }] } }] } },
    { method: 'POST', path: /^\/111\/messages$/, reply: { recipient_id: '900', message_id: 'm_2' } },
  ]);
  const inbox = await engine.listInbox('PAGE-TOKEN', '111');
  assert.match(JSON.stringify(inbox), /t_1/);
  assert.equal(await engine.replyToConversation('PAGE-TOKEN', '111', '900', 'Hello back'), 'm_2');
  const reply = sent.at(-1)!;
  assert.deepEqual(JSON.parse(reply.body.recipient!), { id: '900' });
  assert.equal(reply.body.messaging_type, 'RESPONSE');
  assert.deepEqual(JSON.parse(reply.body.message!), { text: 'Hello back' });
  assert.equal(reply.token, 'PAGE-TOKEN');
  await assert.rejects(engine.replyToConversation('PAGE-TOKEN', '111', 't_1', 'x'), 'a conversation id is not a recipient');
});

test('read_insights: reads each configured Page metric over the period', async () => {
  const { engine, sent } = engineWith([{ path: /^\/111\/insights$/, reply: (s: { query: Record<string, string> }) => ({ data: [{ name: s.query.metric, period: 'day', values: [{ value: 5, end_time: '2026-11-02T08:00:00+0000' }] }] }) }]);
  await engine.getPageInsightObservations('PAGE-TOKEN', '111', new Date('2026-11-01T00:00:00Z'), new Date('2026-11-08T00:00:00Z'));
  assert.deepEqual(sent.map(s => s.query.metric).sort(), ['page_follows', 'page_media_view']);
  assert.ok(sent.every(s => s.token === 'PAGE-TOKEN' && s.query.since && s.query.until));
});

test('ads_read: lists ad accounts and reads their insights by day', async () => {
  const { engine, sent } = engineWith([
    { path: /^\/me\/adaccounts$/, reply: { data: [{ id: 'act_9', name: 'Test ads', currency: 'EUR', account_status: 1 }] } },
    { path: /^\/act_9\/insights$/, reply: { data: [{ impressions: '120', reach: '90', spend: '3.50', date_start: '2026-11-01' }] } },
  ]);
  assert.deepEqual(await engine.discoverAdAccounts('USER-TOKEN'), [{ id: 'act_9', name: 'Test ads', currency: 'EUR', status: 1 }]);
  const rows = await engine.getAdInsights('USER-TOKEN', 'act_9', new Date('2026-11-01'), new Date('2026-11-08'));
  assert.equal(rows.length, 1);
  assert.equal(sent[1]!.query.time_increment, '1');
  assert.equal(sent[1]!.query.fields, 'impressions,reach,spend');
});

test('ads_management: creates campaigns paused only', async () => {
  const { engine, sent } = engineWith([{ method: 'POST', path: /^\/act_9\/campaigns$/, reply: { id: '6001' } }]);
  const created = await engine.createCampaign({ credential: { accessToken: 'USER-TOKEN' }, accountId: 'act_9', name: 'Autumn recipes', objective: 'OUTCOME_TRAFFIC' } as never);
  assert.equal(created.remoteId, '6001');
  assert.equal(sent[0]!.body.status, 'PAUSED');
  assert.equal(sent[0]!.body.objective, 'OUTCOME_TRAFFIC');
  await assert.rejects(engine.createCampaign({ credential: { accessToken: 'x' }, accountId: 'act_9', name: 'x', objective: 'LINK_CLICKS' } as never));
});

test('a Graph error reaches the caller instead of passing as success', async () => {
  const { engine } = engineWith([{ method: 'POST', path: /^\/111\/feed$/, status: 400, reply: { error: { message: '(#200) The user hasn\'t authorized the application', code: 200 } } }]);
  await assert.rejects(engine.publish({ accessToken: 'PAGE-TOKEN', targetId: '111', text: 'x' } as never));
});
