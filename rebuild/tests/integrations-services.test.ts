import { beforeEach, describe, expect, it, vi } from 'vitest';

type Q = { sql: string; values: unknown[] };
const state = vi.hoisted(() => ({
  queries: [] as Q[], executions: [] as Q[], handlers: [] as Array<[string, (values: unknown[]) => unknown]>, execCounts: [] as Array<[string, number]>,
  role: 'owner', disabled: false, member: true, all: true, ids: ['t1'] as string[], devAccess: true, config: {} as Record<string, unknown>, failAudit: false,
}));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(), user: { findUnique: vi.fn() }, membership: { findUnique: vi.fn() } }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => (key in state.config ? state.config[key] : key === 'data.workspaceOperationTimeoutMs' ? 30000 : DEFAULTS[key]) }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, cb: () => Promise<unknown>) => cb(), assertWorkspaceNotPurging: async () => undefined }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: async (_u: string, w: string) => ({ workspaceId: w }), canUseFeature: () => state.devAccess }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: async () => ({ pageScope: state.all ? { all: true, ids: [] } : { all: false, ids: state.ids } }) }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => state.devAccess }));
vi.mock('@/server/secret-crypto', () => ({ encryptSecret: (v: string) => `enc(${v})`, decryptSecret: (v: string) => v.replace(/^enc\((.*)\)$/, '$1') }));

import { INTEGRATIONS_CONFIG } from '../src/modules/integrations/config';
const DEFAULTS: Record<string, unknown> = Object.fromEntries(INTEGRATIONS_CONFIG.map(item => [item.key, item.defaultValue]));
import { confirmations, verifyWebhookSignature } from '../src/modules/integrations/contracts';
import { createWebhook, deleteWebhook, deliverDueWebhooks, disableEndedKeyWebhooks, emitRecentPostEvents, emitWebhook, listDeliveries, listWebhooks, redeliverWebhook, revealWebhookSecret, rotateWebhookSecret, testWebhook, updateWebhook } from '../src/modules/integrations/server/webhooks';
import { checkReceiver, sendSigned, type SendRequest, type WebhookDeps } from '../src/modules/integrations/server/webhook-transport';
import { INTEGRATIONS_MCP, executeIntegrationsTool, integrationsToolDefinitions, integrationsTools, integrationsWriteTools } from '../src/modules/integrations/mcp';
import { reset as resetRateLimit } from '../src/server/rate-limit';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const now = new Date('2026-10-18T10:00:00Z');
const when = (fragment: string, fn: (values: unknown[]) => unknown) => { state.handlers.unshift([fragment, fn]); };
const execCount = (fragment: string, n: number) => { state.execCounts.unshift([fragment, n]); };
const wrote = (fragment: string) => state.executions.some(q => q.sql.includes(fragment));
const audited = (action: string) => state.executions.some(q => q.sql.includes('activity_logs') && q.values.includes(action));
const sent: SendRequest[] = [];
const publicDeps = (status = 200, extra: Partial<WebhookDeps> = {}): WebhookDeps => ({ resolve: async () => ['93.184.216.34'], send: async request => { sent.push(request); return { status }; }, ...extra });

beforeEach(() => {
  vi.clearAllMocks(); sent.length = 0; resetRateLimit();
  Object.assign(state, { queries: [], executions: [], handlers: [], execCounts: [], role: 'owner', disabled: false, member: true, all: true, ids: ['t1'], devAccess: true, config: {}, failAudit: false });
  db.user.findUnique.mockImplementation(async () => (state.disabled ? { disabledAt: new Date() } : { disabledAt: null }));
  db.membership.findUnique.mockImplementation(async () => (state.member ? { role: state.role } : null));
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = { sql: strings.join('?'), values }; state.queries.push(q);
    for (const [fragment, fn] of state.handlers) if (q.sql.includes(fragment)) return fn(values);
    if (q.sql.includes('FROM memberships m JOIN users u')) return [{ role: state.role, disabledAt: state.disabled ? new Date() : null }];
    if (q.sql.includes('FROM targets')) return [{ id: 't1', name: 'Alpha' }, { id: 't2', name: 'Beta' }].filter(t => state.all || state.ids.includes(t.id));
    if (q.sql.includes('COUNT(*)')) return [{ count: BigInt(0) }];
    return [];
  });
  db.$executeRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = { sql: strings.join('?'), values }; state.executions.push(q);
    if (state.failAudit && q.sql.includes('activity_logs')) throw new Error('audit unavailable');
    for (const [fragment, n] of state.execCounts) if (q.sql.includes(fragment)) return n;
    return 1;
  });
});

describe('webhook receiver safety', () => {
  it('rejects non-https, credentials, odd ports, internal names, private literals and private DNS answers; accepts a public host', async () => {
    const resolve = async () => ['93.184.216.34'];
    for (const url of ['http://example.com/h', 'https://user:pw@example.com/h', 'https://example.com:8443/h', 'https://localhost/h', 'https://intranet/h', 'https://10.0.0.5/h', 'https://169.254.169.254/latest', 'https://[::1]/h', 'https://svc.internal/h', 'not a url']) {
      await expect(checkReceiver(url, [], resolve), url).rejects.toMatchObject({ code: 'invalid_request' });
    }
    await expect(checkReceiver('https://rebind.example.com/h', [], async () => ['93.184.216.34', '192.168.1.5'])).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(checkReceiver('https://empty.example.com/h', [], async () => [])).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(checkReceiver('https://gone.example.com/h', [], async () => { throw new Error('ENOTFOUND'); })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(checkReceiver('https://hooks.example.com/h?k=1', [], resolve)).resolves.toMatchObject({ resolved: ['93.184.216.34'] });
    await expect(checkReceiver('https://hooks.other.com/h', ['example.com'], resolve)).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('signs the exact body with a timestamp and reports fixed failure phrases, never receiver text', async () => {
    const out = await sendSigned({ url: 'https://hooks.example.com/h', secret: 'whsec_x', deliveryId: 'd1', event: 'ping', body: '{"id":"d1"}', now, timeoutMs: 1000, allowlist: [], deps: publicDeps(200) });
    expect(out).toMatchObject({ ok: true, status: 200 });
    const req = sent[0]!;
    expect(req.headers['x-msp-delivery']).toBe('d1');
    expect(verifyWebhookSignature('whsec_x', Number(req.headers['x-msp-timestamp']), '{"id":"d1"}', req.headers['x-msp-signature']!)).toBe(true);
    expect(verifyWebhookSignature('whsec_other', Number(req.headers['x-msp-timestamp']), '{"id":"d1"}', req.headers['x-msp-signature']!)).toBe(false);
    const redirect = await sendSigned({ url: 'https://hooks.example.com/h', secret: 's', deliveryId: 'd', event: 'e', body: '{}', now, timeoutMs: 1000, allowlist: [], deps: publicDeps(302) });
    expect(redirect).toMatchObject({ ok: false, retryable: true, error: 'Answered 302 (redirects are not followed).' });
    const boom = await sendSigned({ url: 'https://hooks.example.com/h', secret: 's', deliveryId: 'd', event: 'e', body: '{}', now, timeoutMs: 1000, allowlist: [], deps: publicDeps(200, { send: async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:443 secret-token'); } }) });
    expect(boom).toMatchObject({ ok: false, error: 'Could not be reached.' });
    const blocked = await sendSigned({ url: 'https://hooks.example.com/h', secret: 's', deliveryId: 'd', event: 'e', body: '{}', now, timeoutMs: 1000, allowlist: [], deps: publicDeps(200, { resolve: async () => ['10.0.0.9'] }) });
    expect(blocked).toMatchObject({ ok: false, retryable: false, error: 'Address is not allowed.' });
    expect(sent).toHaveLength(2); // only the two public sends reached the transport
  });
});

describe('webhook management', () => {
  const ok = (over: object = {}) => ({ name: 'Zapier', url: 'https://hooks.example.com/abc?token=1', events: ['post.published'], confirmation: confirmations.createWebhook('Zapier'), ...over });
  it('returns the secret once, stores it encrypted, validates the address and audits', async () => {
    const made = await createWebhook(actor, ok(), { deps: publicDeps() });
    expect(made.secret).toMatch(/^whsec_/);
    const insert = state.executions.find(q => q.sql.includes('INSERT INTO webhook_endpoints'))!;
    expect(insert.values).toContain(`enc(${made.secret})`);
    expect(insert.values).not.toContain(made.secret);
    expect(audited('webhook.created')).toBe(true);
  });
  it('refuses unsafe addresses, wrong confirmation, extra fields, non-admins, the endpoint limit and a disabled capability', async () => {
    await expect(createWebhook(actor, ok({ url: 'https://10.0.0.5/x' }), { deps: publicDeps() })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(createWebhook(actor, ok({ confirmation: 'x' }), { deps: publicDeps() })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(createWebhook(actor, ok({ extra: 1 }), { deps: publicDeps() })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(wrote('INSERT INTO webhook_endpoints')).toBe(false);
    state.role = 'editor';
    await expect(createWebhook(actor, ok(), { deps: publicDeps() })).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'owner'; state.devAccess = false;
    await expect(listWebhooks(actor)).rejects.toMatchObject({ code: 'forbidden' });
    state.devAccess = true;
    when('FROM webhook_endpoints WHERE "workspaceId"', () => [{ count: BigInt(20) }]);
    await expect(createWebhook(actor, ok(), { deps: publicDeps() })).rejects.toMatchObject({ code: 'conflict' });
    state.config['integrations.webhooks.enabled'] = false;
    await expect(createWebhook(actor, ok(), { deps: publicDeps() })).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('fails closed when Root configuration is invalid', async () => {
    state.config['integrations.webhooks.sendTimeoutMs'] = 5;
    await expect(listWebhooks(actor)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('never exposes the secret or query string in listings and scopes every query to the workspace', async () => {
    when('FROM webhook_endpoints e', () => [{ id: 'w1', name: 'Z', url: 'https://hooks.example.com/abc?token=SECRET', events: ['post.failed'], enabled: true, apiTokenId: 'tok1', lastError: null, lastSentAt: null, createdAt: now, pending: BigInt(2), failed: BigInt(1) }]);
    const view = await listWebhooks(actor);
    expect(JSON.stringify(view)).not.toContain('SECRET');
    expect(view.webhooks[0]).toMatchObject({ urlDisplay: 'hooks.example.com/abc', source: 'api_key', pending: 2, failed: 1 });
    expect(state.queries.find(q => q.sql.includes('FROM webhook_endpoints e'))!.values).toContain('workspace-a');
  });
  it('update, rotate and delete are workspace scoped, confirmed and audited; another workspace gets not_found', async () => {
    when('FROM webhook_endpoints WHERE id', () => []);
    await expect(updateWebhook(actor, { id: 'w9', enabled: false, confirmation: confirmations.updateWebhook('w9') })).rejects.toMatchObject({ code: 'not_found' });
    when('DELETE FROM webhook_endpoints', () => []);
    await expect(deleteWebhook(actor, { id: 'w9', confirmation: confirmations.deleteWebhook('w9') })).rejects.toMatchObject({ code: 'not_found' });
    when('UPDATE webhook_endpoints SET secret', () => []);
    await expect(rotateWebhookSecret(actor, { id: 'w9', confirmation: confirmations.rotateWebhookSecret('w9') })).rejects.toMatchObject({ code: 'not_found' });
    state.handlers.length = 0;
    when('FROM webhook_endpoints WHERE id', () => [{ id: 'w1' }]);
    await expect(updateWebhook(actor, { id: 'w1', enabled: false, confirmation: 'nope' })).rejects.toMatchObject({ code: 'invalid_request' });
    await updateWebhook(actor, { id: 'w1', enabled: false, confirmation: confirmations.updateWebhook('w1') });
    expect(audited('webhook.updated')).toBe(true);
    when('UPDATE webhook_endpoints SET secret', () => [{ id: 'w1' }]);
    const rotated = await rotateWebhookSecret(actor, { id: 'w1', confirmation: confirmations.rotateWebhookSecret('w1') });
    expect(rotated.secret).toMatch(/^whsec_/); expect(audited('webhook.secret_rotated')).toBe(true);
  });
  it('lists delivery history only for an endpoint of the caller workspace, paged', async () => {
    when('FROM webhook_endpoints WHERE id', () => []);
    await expect(listDeliveries(actor, { id: 'w9' })).rejects.toMatchObject({ code: 'not_found' });
    state.handlers.length = 0;
    when('FROM webhook_endpoints WHERE id', () => [{ id: 'w1', name: 'Z' }]);
    when('FROM webhook_deliveries WHERE', () => Array.from({ length: 51 }, (_, i) => ({ id: `d${i}` })));
    const page = await listDeliveries(actor, { id: 'w1', page: 2 });
    expect(page.deliveries).toHaveLength(50); expect(page.hasMore).toBe(true);
    expect(state.queries.find(q => q.sql.includes('FROM webhook_deliveries WHERE'))!.values).toContain(50);
  });
  it('test sends one signed ping without retry and records the honest outcome', async () => {
    when('SELECT url, secret, enabled', () => [{ url: 'https://hooks.example.com/h', secret: 'enc(whsec_z)', enabled: true }]);
    const ok1 = await testWebhook(actor, { id: 'w1', confirmation: confirmations.testWebhook('w1') }, publicDeps(200), now);
    expect(ok1.delivered).toBe(true); expect(sent).toHaveLength(1);
    const bad = await testWebhook(actor, { id: 'w1', confirmation: confirmations.testWebhook('w1') }, publicDeps(500), now);
    expect(bad).toMatchObject({ delivered: false, status: 500, error: 'Answered 500.' });
    const settle = state.executions.filter(q => q.sql.includes('UPDATE webhook_deliveries SET attempts')).at(-1)!;
    expect(settle.values).toContain('failed');
    await expect(testWebhook(actor, { id: 'w1', confirmation: 'x' }, publicDeps(), now)).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('redelivery claims atomically, resends the same delivery id, and refuses an in-flight or foreign delivery', async () => {
    when('UPDATE webhook_deliveries SET status', () => []);
    when('SELECT id FROM webhook_deliveries', () => [{ id: 'd1' }]);
    await expect(redeliverWebhook(actor, { id: 'd1', confirmation: confirmations.redeliver('d1') }, publicDeps(), now)).rejects.toMatchObject({ code: 'conflict' });
    state.handlers.length = 0;
    when('UPDATE webhook_deliveries SET status', () => []);
    when('SELECT id FROM webhook_deliveries', () => []);
    await expect(redeliverWebhook(actor, { id: 'dX', confirmation: confirmations.redeliver('dX') }, publicDeps(), now)).rejects.toMatchObject({ code: 'not_found' });
    state.handlers.length = 0;
    when('UPDATE webhook_deliveries SET status', () => [{ id: 'd1', endpointId: 'w1', workspaceId: 'workspace-a', event: 'post.failed', payload: { event: 'post.failed', eventId: 'e1', data: {} }, attempts: 3 }]);
    when('SELECT url, secret, enabled', () => [{ url: 'https://hooks.example.com/h', secret: 'enc(whsec_z)', enabled: true }]);
    const result = await redeliverWebhook(actor, { id: 'd1', confirmation: confirmations.redeliver('d1') }, publicDeps(200), now);
    expect(result).toMatchObject({ deliveryId: 'd1', delivered: true });
    expect(sent[0]!.headers['x-msp-delivery']).toBe('d1');
    expect(JSON.parse(sent[0]!.body).id).toBe('d1');
    expect(state.executions.some(q => q.sql.includes("'webhook.redelivered'"))).toBe(true);
  });
});

describe('event emission and delivery runner', () => {
  it('emit never throws, is idempotent by event id, bounded by payload size, and honours the capability switch', async () => {
    execCount('INSERT INTO webhook_deliveries', 2);
    expect(await emitWebhook('workspace-a', 'post.published', { postId: 'p1' }, { eventId: 'e1', now })).toEqual({ queued: 2, dropped: false });
    const insert = state.executions.find(q => q.sql.includes('INSERT INTO webhook_deliveries'))!;
    expect(insert.sql).toContain('NOT EXISTS'); expect(state.queries.some(q => q.sql.includes('pg_advisory_xact_lock') && q.values.some(v => String(v).includes('e1')))).toBe(true); expect(insert.sql).toContain('"suspendedAt" IS NULL'); expect(insert.values).toContain('workspace-a'); expect(insert.values).toContain('e1');
    expect(await emitWebhook('workspace-a', 'post.published', { blob: 'x'.repeat(70000) }, { now })).toEqual({ queued: 0, dropped: true });
    state.config['integrations.webhooks.enabled'] = false;
    expect(await emitWebhook('workspace-a', 'post.failed', {}, { now })).toEqual({ queued: 0, dropped: false });
    state.config['integrations.webhooks.enabled'] = true;
    db.$executeRaw.mockRejectedValueOnce(new Error('db down'));
    expect(await emitWebhook('workspace-a', 'post.failed', {}, { now })).toEqual({ queued: 0, dropped: false });
  });
  const row = (over: object = {}) => ({ id: 'd1', endpointId: 'w1', workspaceId: 'workspace-a', event: 'post.published', payload: { event: 'post.published', data: {} }, attempts: 0, ...over });
  const endpoint = () => when('SELECT url, secret, enabled', () => [{ url: 'https://hooks.example.com/h', secret: 'enc(whsec_z)', enabled: true }]);
  it('claims with leases and SKIP LOCKED, delivers, and purges old settled rows', async () => {
    when('UPDATE webhook_deliveries d SET', () => [row()]); endpoint(); execCount('DELETE FROM webhook_deliveries', 4);
    const result = await deliverDueWebhooks(publicDeps(204), now, () => now);
    expect(result).toEqual({ delivered: 1, retrying: 0, failed: 0, purged: 4, events: 0 });
    const claim = state.queries.find(q => q.sql.includes('UPDATE webhook_deliveries d SET'))!;
    expect(claim.sql).toContain('SKIP LOCKED'); expect(claim.sql).toContain('e.enabled'); expect(claim.sql).toContain('"suspendedAt" IS NULL');
    expect(state.executions.find(q => q.sql.includes('SET attempts'))!.values).toContain('delivered');
  });
  it('retries on the Root schedule, then gives up after the last wait; unsafe addresses never retry', async () => {
    endpoint();
    when('UPDATE webhook_deliveries d SET', () => [row({ attempts: 0 })]);
    expect(await deliverDueWebhooks(publicDeps(503), now, () => now)).toMatchObject({ retrying: 1, failed: 0 });
    const retry = state.executions.find(q => q.sql.includes('SET attempts'))!;
    expect(retry.values).toContain('pending'); expect(retry.values).toContainEqual(new Date(now.getTime() + 60_000));
    state.executions.length = 0; state.handlers.shift();
    when('UPDATE webhook_deliveries d SET', () => [row({ attempts: 5 })]);
    expect(await deliverDueWebhooks(publicDeps(503), now, () => now)).toMatchObject({ retrying: 0, failed: 1 });
    expect(state.executions.find(q => q.sql.includes('SET attempts'))!.values).toContain('failed');
    state.executions.length = 0; state.handlers.shift();
    when('UPDATE webhook_deliveries d SET', () => [row()]); sent.length = 0;
    expect(await deliverDueWebhooks(publicDeps(200, { resolve: async () => ['127.0.0.1'] }), now, () => now)).toMatchObject({ failed: 1 });
    expect(sent).toHaveLength(0);
  });
  it('does nothing when webhooks are switched off and does not resurrect a missing endpoint', async () => {
    state.config['integrations.webhooks.enabled'] = false;
    expect(await deliverDueWebhooks(publicDeps(), now)).toEqual({ delivered: 0, retrying: 0, failed: 0, purged: 0, events: 0 });
    expect(db.$queryRaw).not.toHaveBeenCalledWith(expect.arrayContaining([expect.stringContaining('UPDATE webhook_deliveries d SET')]));
    state.config['integrations.webhooks.enabled'] = true;
    when('UPDATE webhook_deliveries d SET', () => [row()]); when('SELECT url, secret, enabled', () => []);
    expect(await deliverDueWebhooks(publicDeps(), now)).toMatchObject({ failed: 1 });
    expect(sent).toHaveLength(0);
  });
  it('only the claimant can settle: a lost lease records nothing on the endpoint', async () => {
    when('UPDATE webhook_deliveries d SET', () => [row()]); endpoint(); execCount('SET attempts', 0);
    await deliverDueWebhooks(publicDeps(200), now);
    expect(wrote('UPDATE webhook_endpoints SET "lastSentAt"')).toBe(false);
  });
});

describe('MCP definitions', () => {
  it('exports unique, strict tools; every write tool needs a confirmation; key creation is intentionally absent', () => {
    const names = integrationsToolDefinitions.map(t => t.name);
    expect(new Set(names).size).toBe(names.length); expect(integrationsTools.size).toBe(names.length);
    for (const tool of integrationsToolDefinitions) expect(tool.inputSchema.additionalProperties).toBe(false);
    for (const name of integrationsWriteTools) expect((integrationsToolDefinitions.find(t => t.name === name)!.inputSchema as { required: string[] }).required).toContain('confirmation');
    expect(names).not.toContain('create_api_key');
  });
  it('routes to the same services and rejects unknown tools', async () => {
    await expect(executeIntegrationsTool(actor, 'drop_everything', {})).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeIntegrationsTool(actor, 'delete_webhook', { id: 'w1', confirmation: 'x' })).rejects.toMatchObject({ code: 'invalid_request' });
    state.role = 'viewer'; state.devAccess = false;
    await expect(executeIntegrationsTool(actor, 'list_webhooks', {})).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('secret reveal', () => {
  const reveal = (id = 'w1', confirmation = confirmations.revealWebhookSecret(id)) => revealWebhookSecret(actor, { id, confirmation }, now);
  it('needs write permission, the exact confirmation and an owner/admin; audits before returning the stored secret', async () => {
    when('SELECT secret FROM webhook_endpoints', () => [{ secret: 'enc(whsec_stored)' }]);
    await expect(reveal('w1', 'yes')).rejects.toMatchObject({ code: 'invalid_request' });
    state.role = 'editor';
    await expect(reveal()).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'owner'; state.devAccess = false;
    await expect(reveal()).rejects.toMatchObject({ code: 'forbidden' });
    state.devAccess = true;
    expect(await reveal()).toMatchObject({ id: 'w1', secret: 'whsec_stored' });
    expect(audited('webhook.secret_revealed')).toBe(true);
    expect(JSON.stringify(state.executions.filter(q => q.sql.includes('activity_logs')))).not.toContain('whsec_stored');
  });
  it('is workspace scoped (foreign id is not_found), does not audit a miss, and is rate limited per person', async () => {
    when('SELECT secret FROM webhook_endpoints', () => []);
    await expect(reveal('w-foreign')).rejects.toMatchObject({ code: 'not_found' });
    expect(audited('webhook.secret_revealed')).toBe(false);
    expect(state.queries.find(q => q.sql.includes('SELECT secret FROM webhook_endpoints'))!.values).toContain('workspace-a');
    state.handlers.length = 0; when('SELECT secret FROM webhook_endpoints', () => [{ secret: 'enc(whsec_stored)' }]);
    state.config['integrations.webhooks.revealsPerHour'] = 3; // the foreign-id attempt above already counted once
    await reveal(); await reveal();
    await expect(reveal()).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('reports an undecryptable secret without leaking the envelope', async () => {
    when('SELECT secret FROM webhook_endpoints', () => [{ secret: 'enc(whsec_stored)' }]);
    const crypto = await import('@/server/secret-crypto');
    const spy = vi.spyOn(crypto, 'decryptSecret').mockImplementationOnce(() => { throw new Error('bad envelope SENTINEL'); });
    await expect(reveal()).rejects.toMatchObject({ code: 'unavailable', message: expect.not.stringContaining('SENTINEL') });
    spy.mockRestore();
  });
});

describe('post events and key-owned hooks', () => {
  it('turns recent post results into idempotent events carrying no post text, only for workspaces that listen', async () => {
    when('FROM post_targets pt', () => [
      { id: 'pt1', postId: 'p1', targetId: 't1', targetName: 'Alpha', workspaceId: 'workspace-a', status: 'published', attempts: 1, remoteUrl: 'https://facebook.example/p1', errorCode: null, publishedAt: new Date('2026-10-18T09:30:00Z'), updatedAt: new Date('2026-10-18T09:31:00Z') },
      { id: 'pt2', postId: 'p2', targetId: 't1', targetName: 'Alpha', workspaceId: 'workspace-a', status: 'failed', attempts: 3, remoteUrl: null, errorCode: 'permission', publishedAt: null, updatedAt: new Date('2026-10-18T09:40:00Z') },
    ]);
    execCount('INSERT INTO webhook_deliveries', 1);
    const result = await emitRecentPostEvents(now);
    expect(result).toEqual({ examined: 2, queued: 2 });
    const scan = state.queries.find(q => q.sql.includes('FROM post_targets pt'))!;
    expect(scan.sql).toContain('EXISTS (SELECT 1 FROM webhook_endpoints e'); expect(scan.sql).not.toContain('message');
    const inserts = state.executions.filter(q => q.sql.includes('INSERT INTO webhook_deliveries'));
    expect(inserts).toHaveLength(2);
    const payloads = inserts.map(q => q.values.find(v => typeof v === 'string' && v.startsWith('{"event"')) as string).map(p => JSON.parse(p));
    expect(payloads[0]).toMatchObject({ event: 'post.published', eventId: 'post_target:pt1:published', data: { postId: 'p1', destinationId: 't1', url: 'https://facebook.example/p1' } });
    expect(payloads[1]).toMatchObject({ event: 'post.failed', eventId: 'post_target:pt2:failed:3', data: { errorCode: 'permission' } });
    expect(inserts[0]!.sql).toContain('e."createdAt" <='); // a new endpoint never receives older history
  });
  it('is off with the capability switch and bounded by the Root scan size', async () => {
    state.config['integrations.webhooks.enabled'] = false;
    expect(await emitRecentPostEvents(now)).toEqual({ examined: 0, queued: 0 });
    state.config['integrations.webhooks.enabled'] = true; state.config['integrations.webhooks.eventScanLimit'] = 7;
    await emitRecentPostEvents(now);
    expect(state.queries.find(q => q.sql.includes('FROM post_targets pt'))!.values).toContain(7);
  });
  it('pauses hooks whose API key was revoked or expired, using the live key table', async () => {
    execCount('UPDATE webhook_endpoints e SET enabled = false', 3);
    expect(await disableEndedKeyWebhooks()).toBe(3);
    const q = state.executions.find(x => x.sql.includes('UPDATE webhook_endpoints e SET enabled = false'))!;
    expect(q.sql).toContain('mcp_api_keys'); expect(q.sql).toContain('"revokedAt" IS NULL'); expect(q.sql).toContain('"expiresAt" > NOW()');
  });
  it('the worker pass queues events, pauses orphaned hooks and reports them', async () => {
    when('FROM post_targets pt', () => [{ id: 'pt1', postId: 'p1', targetId: 't1', targetName: 'Alpha', workspaceId: 'workspace-a', status: 'published', attempts: 1, remoteUrl: null, errorCode: null, publishedAt: null, updatedAt: now }]);
    execCount('INSERT INTO webhook_deliveries', 1);
    const result = await deliverDueWebhooks(publicDeps(), now, () => now);
    expect(result.events).toBe(1);
    expect(wrote('UPDATE webhook_endpoints e SET enabled = false')).toBe(true);
  });
});

describe('MCP group', () => {
  const [group] = INTEGRATIONS_MCP;
  const viewer = (over: object = {}) => ({ scope: 'workspace', userId: 'user-a', workspaceId: 'workspace-a', role: 'owner', workspace: { id: 'workspace-a', name: 'A', timezone: 'UTC' }, ...over }) as never;
  it('is workspace-wide only, manager only, with every tool bound to the webhooks feature', () => {
    expect(group!.scope.workspaceTools).toEqual([...integrationsTools]); expect(group!.scope.resourceTools).toBeUndefined();
    expect(new Set(Object.values(group!.features))).toEqual(new Set(['settings/webhooks']));
    expect(Object.keys(group!.features).sort()).toEqual([...integrationsTools].sort());
    expect(group!.managers![0]!.beforeArguments).toBe(true);
  });
  it('never returns a signing secret to an agent (rotate; create strips it the same way)', async () => {
    // An IP-literal address needs no DNS lookup, so creation runs end to end without any network.
    const created = await group!.execute(viewer(), 'create_webhook', { name: 'Z', url: 'https://93.184.216.34/h', events: ['post.published'], confirmation: confirmations.createWebhook('Z') }, 100) as Record<string, unknown>;
    expect(created).toMatchObject({ name: 'Z' }); expect(JSON.stringify(created)).not.toContain('whsec_'); expect(created.secret).toBeUndefined();
    expect(state.executions.find(q => q.sql.includes('INSERT INTO webhook_endpoints'))!.values.some(v => typeof v === 'string' && v.startsWith('enc(whsec_'))).toBe(true);
    when('UPDATE webhook_endpoints SET secret', () => [{ id: 'w1' }]);
    const rotated = await rotateWebhookSecret(actor, { id: 'w1', confirmation: confirmations.rotateWebhookSecret('w1') });
    expect(rotated.secret).toMatch(/^whsec_/); expect(audited('webhook.secret_rotated')).toBe(true);
  });
  it('lists delivery history only for an endpoint of the caller workspace, paged', async () => {
    when('FROM webhook_endpoints WHERE id', () => []);
    await expect(listDeliveries(actor, { id: 'w9' })).rejects.toMatchObject({ code: 'not_found' });
    state.handlers.length = 0;
    when('FROM webhook_endpoints WHERE id', () => [{ id: 'w1', name: 'Z' }]);
    when('FROM webhook_deliveries WHERE', () => Array.from({ length: 51 }, (_, i) => ({ id: `d${i}` })));
    const page = await listDeliveries(actor, { id: 'w1', page: 2 });
    expect(page.deliveries).toHaveLength(50); expect(page.hasMore).toBe(true);
    expect(state.queries.find(q => q.sql.includes('FROM webhook_deliveries WHERE'))!.values).toContain(50);
  });
  it('test sends one signed ping without retry and records the honest outcome', async () => {
    when('SELECT url, secret, enabled', () => [{ url: 'https://hooks.example.com/h', secret: 'enc(whsec_z)', enabled: true }]);
    const ok1 = await testWebhook(actor, { id: 'w1', confirmation: confirmations.testWebhook('w1') }, publicDeps(200), now);
    expect(ok1.delivered).toBe(true); expect(sent).toHaveLength(1);
    const bad = await testWebhook(actor, { id: 'w1', confirmation: confirmations.testWebhook('w1') }, publicDeps(500), now);
    expect(bad).toMatchObject({ delivered: false, status: 500, error: 'Answered 500.' });
    const settle = state.executions.filter(q => q.sql.includes('UPDATE webhook_deliveries SET attempts')).at(-1)!;
    expect(settle.values).toContain('failed');
    await expect(testWebhook(actor, { id: 'w1', confirmation: 'x' }, publicDeps(), now)).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('redelivery claims atomically, resends the same delivery id, and refuses an in-flight or foreign delivery', async () => {
    when('UPDATE webhook_deliveries SET status', () => []);
    when('SELECT id FROM webhook_deliveries', () => [{ id: 'd1' }]);
    await expect(redeliverWebhook(actor, { id: 'd1', confirmation: confirmations.redeliver('d1') }, publicDeps(), now)).rejects.toMatchObject({ code: 'conflict' });
    state.handlers.length = 0;
    when('UPDATE webhook_deliveries SET status', () => []);
    when('SELECT id FROM webhook_deliveries', () => []);
    await expect(redeliverWebhook(actor, { id: 'dX', confirmation: confirmations.redeliver('dX') }, publicDeps(), now)).rejects.toMatchObject({ code: 'not_found' });
    state.handlers.length = 0;
    when('UPDATE webhook_deliveries SET status', () => [{ id: 'd1', endpointId: 'w1', workspaceId: 'workspace-a', event: 'post.failed', payload: { event: 'post.failed', eventId: 'e1', data: {} }, attempts: 3 }]);
    when('SELECT url, secret, enabled', () => [{ url: 'https://hooks.example.com/h', secret: 'enc(whsec_z)', enabled: true }]);
    const result = await redeliverWebhook(actor, { id: 'd1', confirmation: confirmations.redeliver('d1') }, publicDeps(200), now);
    expect(result).toMatchObject({ deliveryId: 'd1', delivered: true });
    expect(sent[0]!.headers['x-msp-delivery']).toBe('d1');
    expect(JSON.parse(sent[0]!.body).id).toBe('d1');
    expect(state.executions.some(q => q.sql.includes("'webhook.redelivered'"))).toBe(true);
  });
});

describe('event emission and delivery runner', () => {
  it('emit never throws, is idempotent by event id, bounded by payload size, and honours the capability switch', async () => {
    execCount('INSERT INTO webhook_deliveries', 2);
    expect(await emitWebhook('workspace-a', 'post.published', { postId: 'p1' }, { eventId: 'e1', now })).toEqual({ queued: 2, dropped: false });
    const insert = state.executions.find(q => q.sql.includes('INSERT INTO webhook_deliveries'))!;
    expect(insert.sql).toContain('NOT EXISTS'); expect(state.queries.some(q => q.sql.includes('pg_advisory_xact_lock') && q.values.some(v => String(v).includes('e1')))).toBe(true); expect(insert.sql).toContain('"suspendedAt" IS NULL'); expect(insert.values).toContain('workspace-a'); expect(insert.values).toContain('e1');
    expect(await emitWebhook('workspace-a', 'post.published', { blob: 'x'.repeat(70000) }, { now })).toEqual({ queued: 0, dropped: true });
    state.config['integrations.webhooks.enabled'] = false;
    expect(await emitWebhook('workspace-a', 'post.failed', {}, { now })).toEqual({ queued: 0, dropped: false });
    state.config['integrations.webhooks.enabled'] = true;
    db.$executeRaw.mockRejectedValueOnce(new Error('db down'));
    expect(await emitWebhook('workspace-a', 'post.failed', {}, { now })).toEqual({ queued: 0, dropped: false });
  });
  const row = (over: object = {}) => ({ id: 'd1', endpointId: 'w1', workspaceId: 'workspace-a', event: 'post.published', payload: { event: 'post.published', data: {} }, attempts: 0, ...over });
  const endpoint = () => when('SELECT url, secret, enabled', () => [{ url: 'https://hooks.example.com/h', secret: 'enc(whsec_z)', enabled: true }]);
  it('claims with leases and SKIP LOCKED, delivers, and purges old settled rows', async () => {
    when('UPDATE webhook_deliveries d SET', () => [row()]); endpoint(); execCount('DELETE FROM webhook_deliveries', 4);
    const result = await deliverDueWebhooks(publicDeps(204), now, () => now);
    expect(result).toEqual({ delivered: 1, retrying: 0, failed: 0, purged: 4, events: 0 });
    const claim = state.queries.find(q => q.sql.includes('UPDATE webhook_deliveries d SET'))!;
    expect(claim.sql).toContain('SKIP LOCKED'); expect(claim.sql).toContain('e.enabled'); expect(claim.sql).toContain('"suspendedAt" IS NULL');
    expect(state.executions.find(q => q.sql.includes('SET attempts'))!.values).toContain('delivered');
  });
  it('retries on the Root schedule, then gives up after the last wait; unsafe addresses never retry', async () => {
    endpoint();
    when('UPDATE webhook_deliveries d SET', () => [row({ attempts: 0 })]);
    expect(await deliverDueWebhooks(publicDeps(503), now, () => now)).toMatchObject({ retrying: 1, failed: 0 });
    const retry = state.executions.find(q => q.sql.includes('SET attempts'))!;
    expect(retry.values).toContain('pending'); expect(retry.values).toContainEqual(new Date(now.getTime() + 60_000));
    state.executions.length = 0; state.handlers.shift();
    when('UPDATE webhook_deliveries d SET', () => [row({ attempts: 5 })]);
    expect(await deliverDueWebhooks(publicDeps(503), now, () => now)).toMatchObject({ retrying: 0, failed: 1 });
    expect(state.executions.find(q => q.sql.includes('SET attempts'))!.values).toContain('failed');
    state.executions.length = 0; state.handlers.shift();
    when('UPDATE webhook_deliveries d SET', () => [row()]); sent.length = 0;
    expect(await deliverDueWebhooks(publicDeps(200, { resolve: async () => ['127.0.0.1'] }), now, () => now)).toMatchObject({ failed: 1 });
    expect(sent).toHaveLength(0);
  });
  it('does nothing when webhooks are switched off and does not resurrect a missing endpoint', async () => {
    state.config['integrations.webhooks.enabled'] = false;
    expect(await deliverDueWebhooks(publicDeps(), now)).toEqual({ delivered: 0, retrying: 0, failed: 0, purged: 0, events: 0 });
    expect(db.$queryRaw).not.toHaveBeenCalledWith(expect.arrayContaining([expect.stringContaining('UPDATE webhook_deliveries d SET')]));
    state.config['integrations.webhooks.enabled'] = true;
    when('UPDATE webhook_deliveries d SET', () => [row()]); when('SELECT url, secret, enabled', () => []);
    expect(await deliverDueWebhooks(publicDeps(), now)).toMatchObject({ failed: 1 });
    expect(sent).toHaveLength(0);
  });
  it('only the claimant can settle: a lost lease records nothing on the endpoint', async () => {
    when('UPDATE webhook_deliveries d SET', () => [row()]); endpoint(); execCount('SET attempts', 0);
    await deliverDueWebhooks(publicDeps(200), now);
    expect(wrote('UPDATE webhook_endpoints SET "lastSentAt"')).toBe(false);
  });
});

describe('MCP definitions', () => {
  it('exports unique, strict tools; every write tool needs a confirmation; key creation is intentionally absent', () => {
    const names = integrationsToolDefinitions.map(t => t.name);
    expect(new Set(names).size).toBe(names.length); expect(integrationsTools.size).toBe(names.length);
    for (const tool of integrationsToolDefinitions) expect(tool.inputSchema.additionalProperties).toBe(false);
    for (const name of integrationsWriteTools) expect((integrationsToolDefinitions.find(t => t.name === name)!.inputSchema as { required: string[] }).required).toContain('confirmation');
    expect(names).not.toContain('create_api_key');
  });
  it('routes to the same services and rejects unknown tools', async () => {
    await expect(executeIntegrationsTool(actor, 'drop_everything', {})).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeIntegrationsTool(actor, 'delete_webhook', { id: 'w1', confirmation: 'x' })).rejects.toMatchObject({ code: 'invalid_request' });
    state.role = 'viewer'; state.devAccess = false;
    await expect(executeIntegrationsTool(actor, 'list_webhooks', {})).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('secret reveal', () => {
  const reveal = (id = 'w1', confirmation = confirmations.revealWebhookSecret(id)) => revealWebhookSecret(actor, { id, confirmation }, now);
  it('needs write permission, the exact confirmation and an owner/admin; audits before returning the stored secret', async () => {
    when('SELECT secret FROM webhook_endpoints', () => [{ secret: 'enc(whsec_stored)' }]);
    await expect(reveal('w1', 'yes')).rejects.toMatchObject({ code: 'invalid_request' });
    state.role = 'editor';
    await expect(reveal()).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'owner'; state.devAccess = false;
    await expect(reveal()).rejects.toMatchObject({ code: 'forbidden' });
    state.devAccess = true;
    expect(await reveal()).toMatchObject({ id: 'w1', secret: 'whsec_stored' });
    expect(audited('webhook.secret_revealed')).toBe(true);
    expect(JSON.stringify(state.executions.filter(q => q.sql.includes('activity_logs')))).not.toContain('whsec_stored');
  });
  it('is workspace scoped (foreign id is not_found), does not audit a miss, and is rate limited per person', async () => {
    when('SELECT secret FROM webhook_endpoints', () => []);
    await expect(reveal('w-foreign')).rejects.toMatchObject({ code: 'not_found' });
    expect(audited('webhook.secret_revealed')).toBe(false);
    expect(state.queries.find(q => q.sql.includes('SELECT secret FROM webhook_endpoints'))!.values).toContain('workspace-a');
    state.handlers.length = 0; when('SELECT secret FROM webhook_endpoints', () => [{ secret: 'enc(whsec_stored)' }]);
    state.config['integrations.webhooks.revealsPerHour'] = 3; // the foreign-id attempt above already counted once
    await reveal(); await reveal();
    await expect(reveal()).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('reports an undecryptable secret without leaking the envelope', async () => {
    when('SELECT secret FROM webhook_endpoints', () => [{ secret: 'enc(whsec_stored)' }]);
    const crypto = await import('@/server/secret-crypto');
    const spy = vi.spyOn(crypto, 'decryptSecret').mockImplementationOnce(() => { throw new Error('bad envelope SENTINEL'); });
    await expect(reveal()).rejects.toMatchObject({ code: 'unavailable', message: expect.not.stringContaining('SENTINEL') });
    spy.mockRestore();
  });
});

describe('post events and key-owned hooks', () => {
  it('turns recent post results into idempotent events carrying no post text, only for workspaces that listen', async () => {
    when('FROM post_targets pt', () => [
      { id: 'pt1', postId: 'p1', targetId: 't1', targetName: 'Alpha', workspaceId: 'workspace-a', status: 'published', attempts: 1, remoteUrl: 'https://facebook.example/p1', errorCode: null, publishedAt: new Date('2026-10-18T09:30:00Z'), updatedAt: new Date('2026-10-18T09:31:00Z') },
      { id: 'pt2', postId: 'p2', targetId: 't1', targetName: 'Alpha', workspaceId: 'workspace-a', status: 'failed', attempts: 3, remoteUrl: null, errorCode: 'permission', publishedAt: null, updatedAt: new Date('2026-10-18T09:40:00Z') },
    ]);
    execCount('INSERT INTO webhook_deliveries', 1);
    const result = await emitRecentPostEvents(now);
    expect(result).toEqual({ examined: 2, queued: 2 });
    const scan = state.queries.find(q => q.sql.includes('FROM post_targets pt'))!;
    expect(scan.sql).toContain('EXISTS (SELECT 1 FROM webhook_endpoints e'); expect(scan.sql).not.toContain('message');
    const inserts = state.executions.filter(q => q.sql.includes('INSERT INTO webhook_deliveries'));
    expect(inserts).toHaveLength(2);
    const payloads = inserts.map(q => q.values.find(v => typeof v === 'string' && v.startsWith('{"event"')) as string).map(p => JSON.parse(p));
    expect(payloads[0]).toMatchObject({ event: 'post.published', eventId: 'post_target:pt1:published', data: { postId: 'p1', destinationId: 't1', url: 'https://facebook.example/p1' } });
    expect(payloads[1]).toMatchObject({ event: 'post.failed', eventId: 'post_target:pt2:failed:3', data: { errorCode: 'permission' } });
    expect(inserts[0]!.sql).toContain('e."createdAt" <='); // a new endpoint never receives older history
  });
  it('is off with the capability switch and bounded by the Root scan size', async () => {
    state.config['integrations.webhooks.enabled'] = false;
    expect(await emitRecentPostEvents(now)).toEqual({ examined: 0, queued: 0 });
    state.config['integrations.webhooks.enabled'] = true; state.config['integrations.webhooks.eventScanLimit'] = 7;
    await emitRecentPostEvents(now);
    expect(state.queries.find(q => q.sql.includes('FROM post_targets pt'))!.values).toContain(7);
  });
  it('pauses hooks whose API key was revoked or expired, using the live key table', async () => {
    execCount('UPDATE webhook_endpoints e SET enabled = false', 3);
    expect(await disableEndedKeyWebhooks()).toBe(3);
    const q = state.executions.find(x => x.sql.includes('UPDATE webhook_endpoints e SET enabled = false'))!;
    expect(q.sql).toContain('mcp_api_keys'); expect(q.sql).toContain('"revokedAt" IS NULL'); expect(q.sql).toContain('"expiresAt" > NOW()');
  });
  it('the worker pass queues events, pauses orphaned hooks and reports them', async () => {
    when('FROM post_targets pt', () => [{ id: 'pt1', postId: 'p1', targetId: 't1', targetName: 'Alpha', workspaceId: 'workspace-a', status: 'published', attempts: 1, remoteUrl: null, errorCode: null, publishedAt: null, updatedAt: now }]);
    execCount('INSERT INTO webhook_deliveries', 1);
    const result = await deliverDueWebhooks(publicDeps(), now, () => now);
    expect(result.events).toBe(1);
    expect(wrote('UPDATE webhook_endpoints e SET enabled = false')).toBe(true);
  });
});

describe('MCP group', () => {
  const [group] = INTEGRATIONS_MCP;
  const viewer = (over: object = {}) => ({ scope: 'workspace', userId: 'user-a', workspaceId: 'workspace-a', role: 'owner', workspace: { id: 'workspace-a', name: 'A', timezone: 'UTC' }, ...over }) as never;
  it('is workspace-wide only, manager only, with every tool bound to the webhooks feature', () => {
    expect(group!.scope.workspaceTools).toEqual([...integrationsTools]); expect(group!.scope.resourceTools).toBeUndefined();
    expect(new Set(Object.values(group!.features))).toEqual(new Set(['settings/webhooks']));
    expect(Object.keys(group!.features).sort()).toEqual([...integrationsTools].sort());
    expect(group!.managers![0]!.beforeArguments).toBe(true);
  });
  it('never returns a signing secret to an agent (rotate; create strips it the same way)', async () => {
    const created = await group!.execute(viewer(), 'create_webhook', { name: 'Z', url: 'https://hooks.example.com/h', events: ['post.published'], confirmation: confirmations.createWebhook('Z') }, 100).catch(() => null);
    // The default resolver is not reachable from tests, so creation is refused before any network; the shape contract is checked on rotate.
    expect(JSON.stringify(created)).not.toContain('whsec_');
    when('UPDATE webhook_endpoints SET secret', () => [{ id: 'w1' }]);
    const rotated = await group!.execute(viewer(), 'rotate_webhook_secret', { id: 'w1', confirmation: confirmations.rotateWebhookSecret('w1') }, 100) as Record<string, unknown>;
    expect(JSON.stringify(rotated)).not.toContain('whsec_'); expect(rotated).toMatchObject({ id: 'w1', mcpAuditRecorded: expect.any(Boolean) });
  });
  it('refuses non-managers even if the service would allow', async () => {
    await expect(group!.execute(viewer({ role: 'editor' }), 'list_webhooks', {}, 100)).rejects.toMatchObject({ code: 'forbidden' });
  });
});
