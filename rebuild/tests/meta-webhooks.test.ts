import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  appSecret: 'app-secret' as string | null,
  verifyToken: 'verify-token' as string | null,
  webhooksEnabled: true,
  deliveries: [] as string[],
  recordedDetail: [] as string[],
  targets: [] as Array<{ id: string; workspaceId: string }>,
  postTarget: null as { id: string } | null,
  conversations: [] as Array<{ id: string }>,
  deliveryRows: [] as Array<{ id: string; receivedAt: Date; pageId: string; eventKind: string; status: string; matchedTargets: number; detail: unknown }>,
  writes: [] as string[],
}));

vi.mock('@/server/config/store', () => ({
  runtimeSecret: vi.fn(async (key: string) => (key === 'meta.appSecret' ? state.appSecret : key === 'meta.webhookVerifyToken' ? state.verifyToken : null)),
  runtimeConfig: vi.fn(async (key: string) => {
    if (key === 'meta.webhooksEnabled') return state.webhooksEnabled;
    if (key === 'meta.webhookDeliveryRetentionDays') return 30;
    if (key === 'security.apiRequestsPerMinute') return 120;
    return null;
  }),
  runtimeConfigBatch: vi.fn(async () => ({})),
}));
vi.mock('@/server/data', () => {
  const queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('INSERT INTO meta_webhook_deliveries')) {
      const eventId = values[2] as string;
      if (state.deliveries.includes(eventId)) return [];
      state.deliveries.push(eventId);
      state.recordedDetail.push(values[7] as string);
      state.writes.push(`delivery:${values[5]}`);
      return [{ id: 'mwd_new' }];
    }
    if (sql.includes('FROM meta_webhook_deliveries WHERE "eventId"')) {
      return state.deliveries.includes(values[0] as string) ? [{ id: 'mwd_1' }] : [];
    }
    if (sql.includes('FROM meta_webhook_deliveries WHERE provider')) return state.deliveryRows;
    if (sql.includes('DELETE FROM meta_webhook_deliveries')) {
      state.writes.push('purge');
      return [{ id: 'mwd_old' }, { id: 'mwd_older' }];
    }
    if (sql.includes('FROM targets t')) return state.targets;
    if (sql.includes('FROM conversations c')) return state.conversations;
    throw new Error(`unexpected query: ${sql}`);
  });
  const executeRaw = vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('INSERT INTO external_posts')) {
      state.writes.push('external_post');
      return 1;
    }
    throw new Error(`unexpected execute: ${sql}`);
  });
  return {
    prisma: {
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
      postTarget: { findFirst: vi.fn(async () => state.postTarget) },
      postComment: { upsert: vi.fn(async () => { state.writes.push('comment'); return {}; }) },
      conversation: { update: vi.fn(async () => { state.writes.push('conversation'); return {}; }) },
      conversationMessage: { upsert: vi.fn(async () => { state.writes.push('message'); return {}; }) },
    },
  };
});

import {
  META_WEBHOOK_DELIVERIES_COPY_DEFAULTS, ingestMetaWebhookDelivery, metaWebhookDeliveriesCopySchema,
  parseMetaWebhookPayload, purgeExpiredWebhookDeliveries, readMetaWebhookDeliveries,
  verifyMetaWebhookSignature, verifyMetaWebhookSubscription, verifyMetaWebhookToken,
} from '@/platforms/facebook/webhooks';
import { handleWebhookDelivery, handleWebhookVerification } from '@/server/platforms/webhooks-http';

const sign = (body: string, secret = 'app-secret') => `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
const SECRET_TEXT = 'customer message text that must never reach diagnostics';

const feedComment = () => JSON.stringify({
  object: 'page',
  entry: [{ id: '111', time: 1761000000, changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', post_id: '111_222', comment_id: '111_333', message: SECRET_TEXT, from: { id: '999', name: 'Visitor' }, created_time: 1761000000 } }] }],
});
const feedPost = () => JSON.stringify({
  object: 'page',
  entry: [{ id: '111', time: 1761000000, changes: [{ field: 'feed', value: { item: 'post', verb: 'add', post_id: '111_444', message: 'Page post text', created_time: 1761000000 } }] }],
});
const messaging = (sender = '999', text: string | null = 'hello there', mid = 'mid.1') => JSON.stringify({
  object: 'page',
  entry: [{ id: '111', time: 1761000000, messaging: [{ sender: { id: sender }, recipient: { id: '111' }, timestamp: 1761000000000, message: { mid, ...(text === null ? {} : { text }) } }] }],
});

beforeEach(() => {
  state.appSecret = 'app-secret';
  state.verifyToken = 'verify-token';
  state.webhooksEnabled = true;
  state.deliveries = [];
  state.recordedDetail = [];
  state.targets = [{ id: 't1', workspaceId: 'w1' }];
  state.postTarget = { id: 'pt1' };
  state.conversations = [{ id: 'c1' }];
  state.deliveryRows = [];
  state.writes = [];
});

describe('Meta webhook signature', () => {
  it('accepts only an exact sha256 hex HMAC of the raw body', () => {
    const body = feedComment();
    expect(verifyMetaWebhookSignature(body, sign(body), 'app-secret')).toBe(true);
    expect(verifyMetaWebhookSignature(body, sign(body, 'other'), 'app-secret')).toBe(false);
    expect(verifyMetaWebhookSignature(`${body} `, sign(body), 'app-secret')).toBe(false);
    expect(verifyMetaWebhookSignature(body, 'SHA256=abc', 'app-secret')).toBe(false);
    expect(verifyMetaWebhookSignature(body, 'sha256=zz', 'app-secret')).toBe(false);
    expect(verifyMetaWebhookSignature(body, null, 'app-secret')).toBe(false);
    expect(verifyMetaWebhookSignature(body, sign(body, ''), '')).toBe(false);
  });

  it('compares the handshake token exactly and refuses an empty secret', () => {
    expect(verifyMetaWebhookToken('verify-token', 'verify-token')).toBe(true);
    expect(verifyMetaWebhookToken('Verify-token', 'verify-token')).toBe(false);
    expect(verifyMetaWebhookToken('verify-token ', 'verify-token')).toBe(false);
    expect(verifyMetaWebhookToken(null, 'verify-token')).toBe(false);
    expect(verifyMetaWebhookToken('x', '')).toBe(false);
  });
});

describe('Meta webhook payload parsing', () => {
  it('normalizes feed comments, feed posts and visitor messages', () => {
    const [comment] = parseMetaWebhookPayload(JSON.parse(feedComment()));
    expect(comment).toMatchObject({ pageId: '111', kind: 'feed_comment', verb: 'add', postId: '111_222', commentId: '111_333', text: SECRET_TEXT, fromId: '999' });
    const [post] = parseMetaWebhookPayload(JSON.parse(feedPost()));
    expect(post).toMatchObject({ pageId: '111', kind: 'feed_post', postId: '111_444' });
    const [message] = parseMetaWebhookPayload(JSON.parse(messaging()));
    expect(message).toMatchObject({ pageId: '111', kind: 'message', messageId: 'mid.1', senderId: '999', text: 'hello there' });
  });

  it('marks echoes, textless messages and unknown fields unknown without storing them', () => {
    expect(parseMetaWebhookPayload(JSON.parse(messaging('111')))[0]!.kind).toBe('unknown');
    expect(parseMetaWebhookPayload(JSON.parse(messaging('999', null)))[0]!.kind).toBe('unknown');
    const unknown = parseMetaWebhookPayload({ object: 'page', entry: [{ id: '111', changes: [{ field: 'ratings', value: { verb: 'add' } }] }] });
    expect(unknown[0]).toMatchObject({ kind: 'unknown', verb: 'add' });
  });

  it('refuses non-Page batches, missing Page ids and oversized entries', () => {
    expect(() => parseMetaWebhookPayload({ object: 'user', entry: [] })).toThrow();
    expect(() => parseMetaWebhookPayload({ object: 'page', entry: [{ id: 'nope' }] })).toThrow();
    expect(() => parseMetaWebhookPayload({ object: 'page', entry: Array.from({ length: 51 }, () => ({ id: '111' })) })).toThrow();
    expect(() => parseMetaWebhookPayload(null)).toThrow();
  });

  it('derives stable event ids so retries converge', () => {
    const first = parseMetaWebhookPayload(JSON.parse(feedComment()))[0]!.eventId;
    const second = parseMetaWebhookPayload(JSON.parse(feedComment()))[0]!.eventId;
    const other = parseMetaWebhookPayload(JSON.parse(feedPost()))[0]!.eventId;
    expect(first).toBe(second);
    expect(first).not.toBe(other);
  });
});

describe('Meta webhook ingestion', () => {
  it('refuses unsigned and unconfigured deliveries before any write', async () => {
    const body = feedComment();
    await expect(ingestMetaWebhookDelivery(body, sign(body, 'other'))).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(ingestMetaWebhookDelivery('not json', sign('not json'))).rejects.toMatchObject({ code: 'invalid_request' });
    state.appSecret = null;
    await expect(ingestMetaWebhookDelivery(body, sign(body))).rejects.toMatchObject({ code: 'unavailable' });
    expect(state.writes).toEqual([]);
  });

  it('stores feed comments on known posts and keeps receipts content-free', async () => {
    const body = feedComment();
    const summary = await ingestMetaWebhookDelivery(body, sign(body));
    expect(summary).toEqual({ received: 1, accepted: 1, duplicates: 0, unmatched: 0, ignored: 0 });
    expect(state.writes).toContain('comment');
    expect(state.writes).toContain('delivery:accepted');
    for (const detail of state.recordedDetail) expect(detail).not.toContain(SECRET_TEXT);
  });

  it('stores feed posts in the external-post store without inventing insights', async () => {
    const body = feedPost();
    const summary = await ingestMetaWebhookDelivery(body, sign(body));
    expect(summary).toMatchObject({ accepted: 1 });
    expect(state.writes).toContain('external_post');
  });

  it('appends visitor messages only to an unambiguous existing thread', async () => {
    const body = messaging();
    expect(await ingestMetaWebhookDelivery(body, sign(body))).toMatchObject({ accepted: 1 });
    expect(state.writes).toContain('message');
  });

  it('records unmatched events when the post, thread or channel cannot resolve', async () => {
    state.postTarget = null;
    const commentBody = feedComment();
    expect(await ingestMetaWebhookDelivery(commentBody, sign(commentBody))).toMatchObject({ accepted: 0, unmatched: 1 });
    expect(state.writes).not.toContain('comment');
    state.postTarget = { id: 'pt1' };
    state.conversations = [];
    const messageBody = messaging('999', 'hello there', 'mid.2');
    expect(await ingestMetaWebhookDelivery(messageBody, sign(messageBody))).toMatchObject({ unmatched: 1 });
    expect(state.writes).not.toContain('message');
    state.conversations = [{ id: 'c1' }, { id: 'c2' }];
    const ambiguousBody = messaging('999', 'hello there', 'mid.3');
    expect(await ingestMetaWebhookDelivery(ambiguousBody, sign(ambiguousBody))).toMatchObject({ unmatched: 1 });
    state.targets = [];
    const orphanBody = feedPost();
    expect(await ingestMetaWebhookDelivery(orphanBody, sign(orphanBody))).toMatchObject({ unmatched: 1 });
  });

  it('treats retried deliveries as duplicates without rewriting stores', async () => {
    const body = feedComment();
    expect(await ingestMetaWebhookDelivery(body, sign(body))).toMatchObject({ accepted: 1 });
    const writes = state.writes.length;
    expect(await ingestMetaWebhookDelivery(body, sign(body))).toMatchObject({ accepted: 0, duplicates: 1 });
    expect(state.writes.length).toBe(writes);
  });

  it('records unknown events and disabled reception as ignored', async () => {
    const unknown = JSON.stringify({ object: 'page', entry: [{ id: '111', changes: [{ field: 'ratings', value: {} }] }] });
    expect(await ingestMetaWebhookDelivery(unknown, sign(unknown))).toMatchObject({ ignored: 1 });
    state.webhooksEnabled = false;
    const body = feedComment();
    expect(await ingestMetaWebhookDelivery(body, sign(body))).toMatchObject({ ignored: 1 });
    expect(state.writes.filter(write => write !== 'delivery:ignored')).toEqual([]);
  });
});

describe('Meta webhook subscription handshake', () => {
  it('echoes the challenge only for the Root token', async () => {
    expect(await verifyMetaWebhookSubscription({ mode: 'subscribe', token: 'verify-token', challenge: 'abc' })).toEqual({ ok: true, challenge: 'abc' });
    expect(await verifyMetaWebhookSubscription({ mode: 'subscribe', token: 'wrong', challenge: 'abc' })).toEqual({ ok: false });
    expect(await verifyMetaWebhookSubscription({ mode: 'unsubscribe', token: 'verify-token', challenge: 'abc' })).toEqual({ ok: false });
    state.verifyToken = null;
    expect(await verifyMetaWebhookSubscription({ mode: 'subscribe', token: 'verify-token', challenge: 'abc' })).toEqual({ ok: false });
  });
});

describe('Meta webhook transport', () => {
  it('answers unknown providers, throttled verification and bad signatures honestly', async () => {
    const get = (token: string | null) => new Request(`https://social.example/api/platforms/facebook/webhooks?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=abc`);
    expect((await handleWebhookVerification(get('verify-token'), 'facebook')).status).toBe(200);
    expect((await handleWebhookVerification(get('wrong'), 'facebook')).status).toBe(403);
    expect((await handleWebhookVerification(get('verify-token'), 'myspace')).status).toBe(404);
    const post = (body: string, signature: string | null) => new Request('https://social.example/api/platforms/facebook/webhooks', { method: 'POST', headers: signature ? { 'x-hub-signature-256': signature } : {}, body });
    const body = feedComment();
    expect((await handleWebhookDelivery(post(body, 'sha256=00'), 'facebook')).status).toBe(401);
    expect((await handleWebhookDelivery(post(body, sign(body)), 'myspace')).status).toBe(404);
    const ok = await handleWebhookDelivery(post(body, sign(body)), 'facebook');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, accepted: 1 });
  });
});

describe('Meta webhook retention and diagnostics', () => {
  it('purges expired receipts in a bounded batch', async () => {
    await expect(purgeExpiredWebhookDeliveries(new Date('2026-10-23T00:00:00Z'))).resolves.toBe(2);
    expect(state.writes).toContain('purge');
  });

  it('reads recent receipts with safe kind and status fallbacks', async () => {
    state.deliveryRows = [
      { id: 'mwd_1', receivedAt: new Date('2026-10-23T00:00:00Z'), pageId: '111', eventKind: 'feed_comment', status: 'accepted', matchedTargets: 2, detail: { verb: 'add', written: 2 } },
      { id: 'mwd_2', receivedAt: new Date('2026-10-23T00:01:00Z'), pageId: '111', eventKind: 'bogus', status: 'bogus', matchedTargets: 0, detail: null },
    ];
    const rows = await readMetaWebhookDeliveries(50);
    expect(rows[0]).toMatchObject({ eventKind: 'feed_comment', status: 'accepted', matchedTargets: 2 });
    expect(rows[1]).toMatchObject({ eventKind: 'unknown', status: 'ignored', detail: {} });
  });

  it('ships a complete bilingual diagnostics catalog', () => {
    expect(metaWebhookDeliveriesCopySchema.safeParse(META_WEBHOOK_DELIVERIES_COPY_DEFAULTS).success).toBe(true);
    for (const locale of ['en', 'fr'] as const) {
      const copy = META_WEBHOOK_DELIVERIES_COPY_DEFAULTS[locale];
      for (const key of ['title', 'intro', 'empty', 'received', 'page', 'kind', 'status', 'targets', 'detail'] as const) expect(copy[key].length).toBeGreaterThan(0);
      for (const kind of ['feed_post', 'feed_comment', 'message', 'unknown'] as const) expect(copy.kinds[kind].length).toBeGreaterThan(0);
      for (const status of ['accepted', 'duplicate', 'unmatched', 'ignored'] as const) expect(copy.statuses[status].length).toBeGreaterThan(0);
    }
    expect(META_WEBHOOK_DELIVERIES_COPY_DEFAULTS.en.title).not.toBe(META_WEBHOOK_DELIVERIES_COPY_DEFAULTS.fr.title);
  });
});
