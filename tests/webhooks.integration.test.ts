import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Outgoing webhooks: events queue one delivery per listening
 * endpoint; the worker signs and sends them, retries with backoff, gives up
 * after the last delay; private addresses are refused.
 */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let webhooks: typeof import('../src/lib/webhooks');
let safeFetch: typeof import('../src/lib/safe-fetch');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('webhooks');
  ({ prisma } = await import('../src/lib/prisma'));
  webhooks = await import('../src/lib/webhooks');
  safeFetch = await import('../src/lib/safe-fetch');
  safeFetch.setResolverForTests(async () => ['93.184.216.34']);
}, 120_000);

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  safeFetch?.setResolverForTests(null);
  await prisma?.$disconnect();
  database?.drop();
});

describe('webhook schema', () => {
  it('takes public https addresses only', () => {
    const base = { name: 'Client A', events: ['post.published'] };
    expect(webhooks.webhookSchema.safeParse({ ...base, url: 'https://hooks.example.com/a' }).success).toBe(true);
    expect(webhooks.webhookSchema.safeParse({ ...base, url: 'http://hooks.example.com/a' }).success).toBe(false);
    expect(webhooks.webhookSchema.safeParse({ ...base, url: 'https://127.0.0.1/a' }).success).toBe(false);
    expect(webhooks.webhookSchema.safeParse({ ...base, url: 'https://localhost/a' }).success).toBe(false);
    expect(webhooks.webhookSchema.safeParse({ ...base, url: 'https://hooks.example.com/a', events: [] }).success).toBe(false);
  });
});

describe('deliveries', () => {
  it('queues per listening endpoint, signs, retries and gives up', async () => {
    const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: 'client-a-hooks', timezone: 'UTC', developerFeatures: true } });
    const { id, secret } = await webhooks.createWebhook(workspace.id, { name: 'Zap', url: 'https://hooks.example.com/zap', events: ['post.published'] });
    await webhooks.createWebhook(workspace.id, { name: 'Other', url: 'https://hooks.example.com/other', events: ['post.failed'] });
    expect(secret).toMatch(/^whsec_/);
    expect((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id } })).secret).not.toContain(secret);

    const now = new Date('2026-10-12T10:00:00Z');
    expect(await webhooks.emitWebhook(workspace.id, 'post.published', { postId: 'p1' }, now)).toBe(1);

    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response('nope', { status: 500 });
    });

    expect(await webhooks.deliverDueWebhooks(now)).toEqual({ delivered: 0, failed: 1 });
    const [call] = calls;
    expect(call!.url).toBe('https://hooks.example.com/zap');
    const body = JSON.parse(call!.body);
    expect(body).toMatchObject({ event: 'post.published', data: { postId: 'p1' } });
    const expected = `sha256=${createHmac('sha256', secret).update(`${call!.headers['x-msp-timestamp']}.${call!.body}`).digest('hex')}`;
    expect(call!.headers['x-msp-signature']).toBe(expected);
    expect(call!.headers['x-msp-delivery']).toBe(body.id);

    let delivery = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: body.id } });
    expect(delivery).toMatchObject({ status: 'pending', attempts: 1, responseStatus: 500 });
    expect(delivery.nextAttemptAt.getTime()).toBe(now.getTime() + 60_000);

    // Not due yet: nothing is sent.
    expect(await webhooks.deliverDueWebhooks(new Date(now.getTime() + 30_000))).toEqual({ delivered: 0, failed: 0 });

    // Every retry fails: after the last delay it gives up.
    let at = now.getTime();
    for (const delay of webhooks.RETRY_DELAYS_MS) {
      at += delay;
      await webhooks.deliverDueWebhooks(new Date(at));
    }
    delivery = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: body.id } });
    expect(delivery).toMatchObject({ status: 'failed', attempts: webhooks.RETRY_DELAYS_MS.length + 1 });
    expect((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id } })).lastError).toBe('Answered 500.');

    // Sent again by hand, and this time the receiver says yes.
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }));
    expect(await webhooks.redeliverWebhook(body.id, workspace.id, new Date(at + 1000))).toMatchObject({ delivered: true, status: 204 });
    expect(await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: body.id } })).toMatchObject({ status: 'delivered' });
    expect((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id } })).lastError).toBeNull();
  });

  it('refuses an address that resolves to a private network, and does not follow redirects', async () => {
    const workspace = await prisma.workspace.create({ data: { name: 'Client B', slug: 'client-b-hooks', timezone: 'UTC', developerFeatures: true } });
    const { id } = await webhooks.createWebhook(workspace.id, { name: 'Sneaky', url: 'https://inside.example.com/x', events: ['post.failed'] });
    const fetchSpy = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }));
    vi.stubGlobal('fetch', fetchSpy);

    safeFetch.setResolverForTests(async () => ['10.0.0.5']);
    const refused = await webhooks.testWebhook(id, workspace.id);
    expect(refused.delivered).toBe(false);
    expect(refused.error).toMatch(/private network/);
    expect(fetchSpy).not.toHaveBeenCalled();

    safeFetch.setResolverForTests(async () => ['93.184.216.34']);
    const redirected = await webhooks.testWebhook(id, workspace.id);
    expect(redirected).toMatchObject({ delivered: false, status: 302 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('queues nothing for a switched-off endpoint, and never throws', async () => {
    const workspace = await prisma.workspace.create({ data: { name: 'Client C', slug: 'client-c-hooks', timezone: 'UTC', developerFeatures: true } });
    const { id } = await webhooks.createWebhook(workspace.id, { name: 'Off', url: 'https://hooks.example.com/off', events: ['report.ready'] });
    await prisma.webhookEndpoint.update({ where: { id }, data: { enabled: false } });
    expect(await webhooks.emitWebhook(workspace.id, 'report.ready', {})).toBe(0);
    expect(await webhooks.emitWebhook('no-such-workspace', 'report.ready', {})).toBe(0);
  });

  it('queues nothing once root switches developer features off', async () => {
    const workspace = await prisma.workspace.create({ data: { name: 'Client D', slug: 'client-d-hooks', timezone: 'UTC', developerFeatures: true } });
    await webhooks.createWebhook(workspace.id, { name: 'Zap', url: 'https://hooks.example.com/d', events: ['report.ready'] });
    await prisma.workspace.update({ where: { id: workspace.id }, data: { developerFeatures: false } });
    expect(await webhooks.emitWebhook(workspace.id, 'report.ready', {})).toBe(0);
  });
});
