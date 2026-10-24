import { beforeEach, describe, expect, it, vi } from 'vitest';

type Q = { sql: string; values: unknown[] };
const state = vi.hoisted(() => ({
  queries: [] as Q[], executions: [] as Q[], handlers: [] as Array<[string, (values: unknown[]) => unknown]>,
  session: true as boolean, sessionWorkspace: 'workspace-a', role: 'owner', config: {} as Record<string, unknown>,
  /** The viewer the bearer check resolves; null means an invalid, revoked or expired key. */
  key: null as null | Record<string, unknown>, grants: { read: true, write: true },
  targets: [] as Array<{ id: string; name: string; type: string }>, targetWhere: null as unknown,
}));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(), user: { findUnique: vi.fn() }, membership: { findUnique: vi.fn() }, target: { findMany: vi.fn() } }));
vi.mock('@/server/data', () => ({ prisma: db, getSessionByTokenHash: async () => state.session ? { userId: 'user-a', user: { id: 'user-a', disabledAt: null }, expiresAt: new Date('2099-01-01'), pending: null } : null }));
vi.mock('@/modules/settings/server/account-session', () => ({ accountSessionActor: async (userId: string, workspaceId: string) => ({ userId, workspaceId, sessionTokenHash: 'synthetic-hash' }) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => (key in state.config ? state.config[key] : key === 'data.workspaceOperationTimeoutMs' ? 30000 : DEFAULTS[key]) }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, cb: () => Promise<unknown>) => cb(), assertWorkspaceNotPurging: async () => undefined }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: async (_u: string, w: string) => ({ workspaceId: w }), canUseFeature: () => true, entitledPlatformIds: () => ['facebook'] }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: async () => ({ pageScope: { all: true, ids: [] }, features: { 'settings/webhooks': { read: state.grants.read, write: state.grants.write } } }) }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: (p: { features: Record<string, { read: boolean; write: boolean }> }, feature: string, access = 'read') => Boolean(p.features?.[feature]?.[access as 'read' | 'write']) }));
vi.mock('@/server/platforms/resource-visibility', () => ({ selectedResourceConnectionWhere: async (workspaceId: string) => ({ workspaceId, invalidatedAt: null }) }));
vi.mock('@/server/client-ip', () => ({ clientIp: (request: Request) => request.headers.get('x-test-ip') ?? 'ip-1' }));
vi.mock('@/server/secret-crypto', () => ({ encryptSecret: (v: string) => `enc(${v})`, decryptSecret: (v: string) => v.replace(/^enc\((.*)\)$/, '$1') }));
vi.mock('@/server/mcp/bearer', () => ({ authenticateBearerHeader: async () => state.key }));
vi.mock('@/server/context', () => ({
  requireViewer: async () => { if (!state.session) throw { digest: 'NEXT_REDIRECT;/sign-in' }; return { user: { id: 'user-a' }, workspaceId: state.sessionWorkspace }; },
}));

import { INTEGRATIONS_CONFIG } from '../src/modules/integrations/config';
const DEFAULTS: Record<string, unknown> = Object.fromEntries(INTEGRATIONS_CONFIG.map(item => [item.key, item.defaultValue]));
import { confirmations } from '../src/modules/integrations/contracts';
import { reset as resetRateLimit } from '../src/server/rate-limit';
import * as webhooksRoute from '../src/app/api/webhooks/route';
import * as webhookRoute from '../src/app/api/webhooks/[id]/route';
import * as testRoute from '../src/app/api/webhooks/[id]/test/route';
import * as secretRoute from '../src/app/api/webhooks/[id]/secret/route';
import * as revealRoute from '../src/app/api/webhooks/[id]/secret/reveal/route';
import * as deliveriesRoute from '../src/app/api/webhooks/[id]/deliveries/route';
import * as deliveryRoute from '../src/app/api/webhooks/[id]/deliveries/[deliveryId]/route';
import * as meRoute from '../src/app/api/v1/me/route';
import * as pagesRoute from '../src/app/api/v1/pages/route';
import * as v1HooksRoute from '../src/app/api/v1/webhooks/route';
import * as v1HookRoute from '../src/app/api/v1/webhooks/[id]/route';

const TOKEN = `mcp_${'a'.repeat(43)}`;
const origin = 'https://app.test';
const when = (fragment: string, fn: (values: unknown[]) => unknown) => { state.handlers.unshift([fragment, fn]); };
const wrote = (fragment: string) => state.executions.some(q => q.sql.includes(fragment));
const params = (id: string, extra: { deliveryId?: string } = {}) => ({ params: Promise.resolve({ id, deliveryId: extra.deliveryId ?? 'd1' }) });
const session = (path: string, method = 'GET', body?: unknown, sameOrigin = true) => new Request(`${origin}${path}`, { method, headers: { 'content-type': 'application/json', ...(sameOrigin ? { origin } : { origin: 'https://evil.test' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const keyed = (path: string, method = 'GET', body?: unknown, ip = 'ip-1') => new Request(`${origin}${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-test-ip': ip }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const bearerless = (path: string, method = 'GET') => new Request(`${origin}${path}`, { method });

const viewer = (over: Record<string, unknown> = {}) => ({
  scope: 'workspace', userId: 'user-a', workspaceId: 'workspace-a', role: 'owner', apiKeyId: 'mcpkey_1', entitlements: { workspaceId: 'workspace-a' },
  workspace: { id: 'workspace-a', name: 'Acme', timezone: 'UTC' }, maxResultItems: 100, resourceRestricted: false,
  permissions: { pageScope: { all: true, ids: [] }, features: { 'settings/webhooks': { read: true, write: true }, 'settings/connections': { read: true, write: false }, 'publishing/posts': { read: true, write: false } } },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks(); resetRateLimit();
  Object.assign(state, { queries: [], executions: [], handlers: [], session: true, sessionWorkspace: 'workspace-a', role: 'owner', config: {}, key: viewer(), grants: { read: true, write: true }, targets: [], targetWhere: null });
  db.user.findUnique.mockImplementation(async () => ({ disabledAt: null }));
  db.membership.findUnique.mockImplementation(async () => ({ role: state.role }));
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.target.findMany.mockImplementation(async (args: { where: unknown }) => { state.targetWhere = args.where; return state.targets; });
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = { sql: strings.join('?'), values }; state.queries.push(q);
    for (const [fragment, fn] of state.handlers) if (q.sql.includes(fragment)) return fn(values);
    if (q.sql.includes('FROM memberships m JOIN users u')) return [{ role: state.role, disabledAt: null }];
    if (q.sql.includes('COUNT(*)')) return [{ count: BigInt(0) }];
    return [];
  });
  db.$executeRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => { state.executions.push({ sql: strings.join('?'), values }); return 1; });
});

const body = async (response: Response) => response.json() as Promise<Record<string, unknown>>;

describe('session routes: anonymous, cross-origin and foreign-workspace refusal for every route', () => {
  const calls: Array<[string, () => Promise<Response>, boolean]> = [
    ['GET /api/webhooks', () => webhooksRoute.GET(session('/api/webhooks')), false],
    ['POST /api/webhooks', () => webhooksRoute.POST(session('/api/webhooks', 'POST', { name: 'Z', url: 'https://93.184.216.34/h', events: ['post.published'], confirmation: confirmations.createWebhook('Z') })), true],
    ['PATCH /api/webhooks/[id]', () => webhookRoute.PATCH(session('/api/webhooks/w1', 'PATCH', { enabled: false, confirmation: confirmations.updateWebhook('w1') }), params('w1')), true],
    ['DELETE /api/webhooks/[id]', () => webhookRoute.DELETE(session('/api/webhooks/w1', 'DELETE', { confirmation: confirmations.deleteWebhook('w1') }), params('w1')), true],
    ['POST /api/webhooks/[id]/test', () => testRoute.POST(session('/api/webhooks/w1/test', 'POST', { confirmation: confirmations.testWebhook('w1') }), params('w1')), true],
    ['POST /api/webhooks/[id]/secret', () => secretRoute.POST(session('/api/webhooks/w1/secret', 'POST', { confirmation: confirmations.rotateWebhookSecret('w1') }), params('w1')), true],
    ['POST /api/webhooks/[id]/secret/reveal', () => revealRoute.POST(session('/api/webhooks/w1/secret/reveal', 'POST', { confirmation: confirmations.revealWebhookSecret('w1') }), params('w1')), true],
    ['GET /api/webhooks/[id]/deliveries', () => deliveriesRoute.GET(session('/api/webhooks/w1/deliveries'), params('w1')), false],
    ['POST /api/webhooks/[id]/deliveries/[deliveryId]', () => deliveryRoute.POST(session('/api/webhooks/w1/deliveries/d1', 'POST', { confirmation: confirmations.redeliver('d1') }), params('w1', { deliveryId: 'd1' })), true],
  ];
  it.each(calls)('%s refuses an anonymous caller without touching storage', async (_name, run) => {
    state.session = false;
    const response = await run();
    expect(response.status).toBe(401); expect(await body(response)).toMatchObject({ code: 'unauthorized' });
    expect(db.$queryRaw).not.toHaveBeenCalled(); expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it.each(calls.filter(([, , write]) => write))('%s refuses a cross-origin write', async (name) => {
    const run = {
      'POST /api/webhooks': () => webhooksRoute.POST(session('/api/webhooks', 'POST', {}, false)),
      'PATCH /api/webhooks/[id]': () => webhookRoute.PATCH(session('/api/webhooks/w1', 'PATCH', {}, false), params('w1')),
      'DELETE /api/webhooks/[id]': () => webhookRoute.DELETE(session('/api/webhooks/w1', 'DELETE', {}, false), params('w1')),
      'POST /api/webhooks/[id]/test': () => testRoute.POST(session('/api/webhooks/w1/test', 'POST', {}, false), params('w1')),
      'POST /api/webhooks/[id]/secret': () => secretRoute.POST(session('/api/webhooks/w1/secret', 'POST', {}, false), params('w1')),
      'POST /api/webhooks/[id]/secret/reveal': () => revealRoute.POST(session('/api/webhooks/w1/secret/reveal', 'POST', {}, false), params('w1')),
      'POST /api/webhooks/[id]/deliveries/[deliveryId]': () => deliveryRoute.POST(session('/api/webhooks/w1/deliveries/d1', 'POST', {}, false), params('w1', { deliveryId: 'd1' })),
    }[name]!;
    const response = await run();
    expect(response.status).toBe(403); expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('a request with no Origin header cannot write either', async () => {
    const request = new Request(`${origin}/api/webhooks/w1`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: confirmations.deleteWebhook('w1') }) });
    expect((await webhookRoute.DELETE(request, params('w1'))).status).toBe(403);
  });
  it.each(calls.filter(([name]) => name !== 'GET /api/webhooks' && name !== 'POST /api/webhooks'))('%s resolves ids only inside the caller workspace: a foreign id is not found and nothing is written', async (_name, run) => {
    when('FROM webhook_deliveries', () => []); when('webhook_endpoints', () => []); when('UPDATE webhook_deliveries', () => []);
    const response = await run();
    expect(response.status).toBe(404);
    for (const q of state.queries.filter(x => /webhook_(endpoints|deliveries)/.test(x.sql) && !x.sql.includes('COUNT'))) expect(q.values, q.sql).toContain('workspace-a');
    expect(wrote('INSERT INTO webhook_deliveries')).toBe(false); expect(wrote('activity_logs')).toBe(false);
  });
  it.each([['viewer'], ['editor'], ['contributor'], ['client']])('refuses a %s member on every verb', async role => {
    state.role = role;
    for (const [, run] of calls) { const response = await run(); expect(response.status, role).toBe(403); }
    expect(wrote('INSERT INTO webhook_endpoints')).toBe(false); expect(wrote('DELETE')).toBe(false);
  });
  it('requires write permission to change anything but only read permission to list', async () => {
    state.grants = { read: true, write: false }; when('FROM webhook_endpoints e', () => []);
    expect((await webhooksRoute.GET(session('/api/webhooks'))).status).toBe(200);
    expect((await webhookRoute.DELETE(session('/api/webhooks/w1', 'DELETE', { confirmation: confirmations.deleteWebhook('w1') }), params('w1'))).status).toBe(403);
    expect((await revealRoute.POST(session('/api/webhooks/w1/secret/reveal', 'POST', { confirmation: confirmations.revealWebhookSecret('w1') }), params('w1'))).status).toBe(403);
  });
  it('rejects malformed bodies, unknown query keys and a wrong confirmation with a safe 400', async () => {
    const malformed = new Request(`${origin}/api/webhooks`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{nope' });
    expect((await webhooksRoute.POST(malformed)).status).toBe(400);
    expect((await deliveriesRoute.GET(session('/api/webhooks/w1/deliveries?page=1&x=1'), params('w1'))).status).toBe(400);
    expect((await deliveriesRoute.GET(session('/api/webhooks/w1/deliveries?page=0'), params('w1'))).status).toBe(400);
    const wrong = await webhookRoute.DELETE(session('/api/webhooks/w1', 'DELETE', { confirmation: 'nope' }), params('w1'));
    expect(wrong.status).toBe(400); expect(JSON.stringify(await body(wrong))).not.toMatch(/SELECT|prisma|stack/i);
  });
  it('never returns a secret from list or delivery endpoints', async () => {
    when('FROM webhook_endpoints e', () => [{ id: 'w1', name: 'Z', url: 'https://hooks.example.com/h?token=SECRETQ', events: ['post.failed'], enabled: true, apiTokenId: null, lastError: null, lastSentAt: null, createdAt: new Date(), pending: BigInt(0), failed: BigInt(0) }]);
    const text = JSON.stringify(await body(await webhooksRoute.GET(session('/api/webhooks'))));
    expect(text).not.toMatch(/SECRETQ|whsec_|enc\(/);
    expect(text).toContain('hooks.example.com/h');
  });
});

describe('REST v1: key authentication and ceilings', () => {
  it('refuses a missing, malformed or unknown key identically and throttles repeated rejects per caller address', async () => {
    state.key = null;
    for (const request of [bearerless('/api/v1/me'), keyed('/api/v1/me')]) {
      const response = await meRoute.GET(request);
      expect(response.status).toBe(401); expect(await body(response)).toMatchObject({ code: 'unauthorized' });
    }
    state.config['integrations.api.failedAuthPerMinute'] = 3;
    resetRateLimit();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await meRoute.GET(keyed('/api/v1/me', 'GET', undefined, 'attacker'))).status);
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
    const limited = await meRoute.GET(keyed('/api/v1/me', 'GET', undefined, 'attacker'));
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
    expect((await meRoute.GET(keyed('/api/v1/me', 'GET', undefined, 'other-caller'))).status).toBe(401);
  });
  it('gives back the throttle count on success so legitimate callers are never limited by their own traffic', async () => {
    state.config['integrations.api.failedAuthPerMinute'] = 2; state.config['integrations.api.ratePerMinute'] = 1000;
    for (let i = 0; i < 6; i += 1) expect((await meRoute.GET(keyed('/api/v1/me'))).status).toBe(200);
  });
  it('limits each key per minute', async () => {
    state.config['integrations.api.ratePerMinute'] = 2;
    expect((await meRoute.GET(keyed('/api/v1/me'))).status).toBe(200);
    expect((await meRoute.GET(keyed('/api/v1/me'))).status).toBe(200);
    expect((await meRoute.GET(keyed('/api/v1/me'))).status).toBe(429);
  });
  it('is off when Root switches the REST API off', async () => {
    state.config['integrations.api.enabled'] = false;
    const response = await meRoute.GET(keyed('/api/v1/me'));
    expect(await body(response)).toMatchObject({ code: 'unavailable' }); expect(response.status).toBeGreaterThanOrEqual(400);
  });
  it('never accepts an installation (Root) viewer or a session without a key id', async () => {
    state.key = { scope: 'installation', userId: 'user-a', isInstanceOwner: true };
    expect((await meRoute.GET(keyed('/api/v1/me'))).status).toBe(401);
    state.key = viewer({ apiKeyId: undefined });
    expect((await meRoute.GET(keyed('/api/v1/me'))).status).toBe(401);
  });
  it('never reads cookies: a session alone does not authenticate /api/v1', async () => {
    state.session = true; state.key = null;
    expect((await meRoute.GET(new Request(`${origin}/api/v1/me`, { headers: { cookie: 'sp_session=valid' } }))).status).toBe(401);
  });
  it('/me describes only the key: workspace, role, granted features and channel scope; no credentials', async () => {
    state.key = viewer({ permissions: { pageScope: { all: false, ids: ['t1'] }, features: { 'settings/webhooks': { read: true, write: false }, 'publishing/posts': { read: true, write: false } } }, resourceRestricted: true });
    const result = await body(await meRoute.GET(keyed('/api/v1/me')));
    expect(result).toMatchObject({ workspace: { id: 'workspace-a', name: 'Acme' }, role: 'owner', channels: ['t1'], access: { read: ['publishing/posts', 'settings/webhooks'], write: [] } });
    expect(JSON.stringify(result)).not.toMatch(/mcp_|tokenHash|secret/i);
  });
  it('/pages needs the Connections read grant and stays inside the key channel ceiling', async () => {
    state.key = viewer({ permissions: { pageScope: { all: false, ids: ['t1'] }, features: { 'settings/connections': { read: true, write: false } } }, resourceRestricted: true });
    state.targets = [{ id: 't1', name: 'Alpha', type: 'page' }];
    const result = await body(await pagesRoute.GET(keyed('/api/v1/pages')));
    expect(result).toEqual({ pages: [{ id: 't1', name: 'Alpha', type: 'page' }] });
    expect(state.targetWhere).toMatchObject({ workspaceId: 'workspace-a', enabled: true, id: { in: ['t1'] } });
    state.key = viewer({ permissions: { pageScope: { all: false, ids: [] }, features: { 'settings/connections': { read: true, write: false } } } });
    db.target.findMany.mockClear();
    expect(await body(await pagesRoute.GET(keyed('/api/v1/pages')))).toEqual({ pages: [] }); // an explicit empty ceiling is a denial, not "all"
    expect(db.target.findMany).not.toHaveBeenCalled();
    state.key = viewer({ permissions: { pageScope: { all: true, ids: [] }, features: { 'settings/webhooks': { read: true, write: true } } } });
    expect((await pagesRoute.GET(keyed('/api/v1/pages'))).status).toBe(403);
  });
  it('webhook endpoints need the Webhooks grant at the right level; a read-only key cannot subscribe or unsubscribe', async () => {
    state.key = viewer({ permissions: { pageScope: { all: true, ids: [] }, features: { 'publishing/posts': { read: true, write: true } } } });
    expect((await v1HooksRoute.GET(keyed('/api/v1/webhooks'))).status).toBe(403);
    state.key = viewer({ permissions: { pageScope: { all: true, ids: [] }, features: { 'settings/webhooks': { read: true, write: false } } } });
    expect((await v1HooksRoute.GET(keyed('/api/v1/webhooks'))).status).toBe(200);
    expect((await v1HooksRoute.POST(keyed('/api/v1/webhooks', 'POST', { url: 'https://93.184.216.34/h', events: ['post.failed'] }))).status).toBe(403);
    expect((await v1HookRoute.DELETE(keyed('/api/v1/webhooks/w1', 'DELETE'), params('w1'))).status).toBe(403);
    expect(wrote('INSERT INTO webhook_endpoints')).toBe(false);
  });
  it('a key limited to selected channels cannot create, list or remove workspace-wide webhooks', async () => {
    state.key = viewer({ resourceRestricted: true });
    expect((await v1HooksRoute.GET(keyed('/api/v1/webhooks'))).status).toBe(403);
    expect((await v1HooksRoute.POST(keyed('/api/v1/webhooks', 'POST', { url: 'https://93.184.216.34/h', events: ['post.failed'] }))).status).toBe(403);
    expect((await v1HookRoute.DELETE(keyed('/api/v1/webhooks/w1', 'DELETE'), params('w1'))).status).toBe(403);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('the key owner is checked live: a key that grants the feature still fails once its owner is no longer an owner/admin', async () => {
    state.role = 'editor';
    expect((await v1HooksRoute.GET(keyed('/api/v1/webhooks'))).status).toBe(403);
    expect((await v1HooksRoute.POST(keyed('/api/v1/webhooks', 'POST', { url: 'https://93.184.216.34/h', events: ['post.failed'] }))).status).toBe(403);
    expect(wrote('INSERT INTO webhook_endpoints')).toBe(false);
  });
  it('subscribing records the key as the source, validates the address and returns the secret only in that response', async () => {
    const response = await v1HooksRoute.POST(keyed('/api/v1/webhooks', 'POST', { name: 'Zap', url: 'https://93.184.216.34/h', events: ['post.published'] }));
    expect(response.status).toBe(201);
    const created = await body(response);
    expect(created.secret).toMatch(/^whsec_/);
    const insert = state.executions.find(q => q.sql.includes('INSERT INTO webhook_endpoints'))!;
    expect(insert.values).toContain('mcpkey_1'); expect(insert.values).toContain('workspace-a'); expect(insert.values).toContain(`enc(${created.secret})`); expect(insert.values).not.toContain(created.secret);
    expect(state.executions.some(q => q.sql.includes('activity_logs') && q.values.includes('webhook.created'))).toBe(true);
    for (const url of ['http://hooks.example.com/h', 'https://10.0.0.5/h', 'https://169.254.169.254/']) {
      expect((await v1HooksRoute.POST(keyed('/api/v1/webhooks', 'POST', { url, events: ['post.failed'] }))).status, url).toBe(400);
    }
    expect((await v1HooksRoute.POST(keyed('/api/v1/webhooks', 'POST', { url: 'https://93.184.216.34/h', events: ['post.failed'], enabled: true }))).status).toBe(400);
  });
  it('lists and removes only the hooks this key created, inside its own workspace', async () => {
    when('FROM webhook_endpoints WHERE "workspaceId"', () => []);
    await v1HooksRoute.GET(keyed('/api/v1/webhooks'));
    const list = state.queries.find(q => q.sql.includes('"apiTokenId" ='))!;
    expect(list.values).toEqual(['workspace-a', 'mcpkey_1']);
    when('DELETE FROM webhook_endpoints', () => []);
    const other = await v1HookRoute.DELETE(keyed('/api/v1/webhooks/w-of-another-key', 'DELETE'), params('w-of-another-key'));
    expect(other.status).toBe(404);
    const del = state.queries.find(q => q.sql.includes('DELETE FROM webhook_endpoints'))!;
    expect(del.sql).toContain('"apiTokenId"'); expect(del.values).toEqual(['w-of-another-key', 'workspace-a', 'mcpkey_1']);
    state.handlers.length = 0; when('DELETE FROM webhook_endpoints', () => [{ id: 'w1' }]);
    expect((await v1HookRoute.DELETE(keyed('/api/v1/webhooks/w1', 'DELETE'), params('w1'))).status).toBe(200);
    expect(state.executions.some(q => q.sql.includes('activity_logs') && q.values.includes('webhook.deleted'))).toBe(true);
  });
  it('a key from workspace B never sees or touches workspace A: every statement carries the key workspace', async () => {
    state.key = viewer({ workspaceId: 'workspace-b', workspace: { id: 'workspace-b', name: 'B', timezone: 'UTC' }, apiKeyId: 'mcpkey_b' });
    when('FROM webhook_endpoints WHERE "workspaceId"', () => []);
    await v1HooksRoute.GET(keyed('/api/v1/webhooks'));
    await v1HooksRoute.POST(keyed('/api/v1/webhooks', 'POST', { url: 'https://93.184.216.34/h', events: ['post.failed'] }));
    for (const q of [...state.queries, ...state.executions].filter(x => /webhook_endpoints|activity_logs/.test(x.sql) && !x.sql.includes('memberships'))) {
      expect(q.values, q.sql).not.toContain('workspace-a'); expect(q.values, q.sql).toContain('workspace-b');
    }
  });
});
