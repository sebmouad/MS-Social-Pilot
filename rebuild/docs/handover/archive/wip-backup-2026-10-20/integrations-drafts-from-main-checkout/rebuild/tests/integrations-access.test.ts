import { beforeEach, describe, expect, it, vi } from 'vitest';

type Q = { sql: string; values: unknown[] };
const state = vi.hoisted(() => ({
  queries: [] as Q[], executions: [] as Q[], handlers: [] as Array<[string, (values: unknown[]) => unknown]>,
  role: 'owner', disabled: false, member: true, all: true, ids: ['t1'] as string[], devAccess: true, config: {} as Record<string, unknown>, columns: true, entitled: true,
}));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(), user: { findUnique: vi.fn() }, membership: { findUnique: vi.fn() } }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => (key in state.config ? state.config[key] : key === 'data.workspaceOperationTimeoutMs' ? 30000 : DEFAULTS[key]) }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, cb: () => Promise<unknown>) => cb(), assertWorkspaceNotPurging: async () => undefined }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: async (_u: string, w: string) => (state.entitled ? { workspaceId: w } : null), canUseFeature: () => state.devAccess }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: async () => ({ pageScope: state.all ? { all: true, ids: [] } : { all: false, ids: state.ids } }) }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => state.devAccess }));
vi.mock('@/server/client-ip', () => ({ clientIp: (request: Request) => request.headers.get('x-test-ip') ?? 'ip-1' }));
vi.mock('@/server/secret-crypto', () => ({ encryptSecret: (v: string) => `enc(${v})`, decryptSecret: (v: string) => v }));

import { INTEGRATIONS_CONFIG } from '../src/modules/integrations/config';
const DEFAULTS: Record<string, unknown> = Object.fromEntries(INTEGRATIONS_CONFIG.map(item => [item.key, item.defaultValue]));
import { API_TOKEN_SHAPE, confirmations, isAllowedRedirect, s256, sha256 } from '../src/modules/integrations/contracts';
import { resetCapabilityCache } from '../src/modules/integrations/server/core';
import { authenticateApiKey, createApiToken, listApiTokens, revokeApiToken } from '../src/modules/integrations/server/tokens';
import { authorizeConnector, describeClientForConsent, exchangeCode, registerClient } from '../src/modules/integrations/server/oauth';
import { restMe, restSubscribe, restUnsubscribe } from '../src/modules/integrations/server/rest';
import { reset as resetRateLimit } from '../src/server/rate-limit';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const now = new Date('2026-10-18T10:00:00Z');
const when = (fragment: string, fn: (values: unknown[]) => unknown) => { state.handlers.unshift([fragment, fn]); };
const audited = (action: string) => state.executions.some(q => q.sql.includes('activity_logs') && q.values.includes(action));
const wrote = (fragment: string) => state.executions.some(q => q.sql.includes(fragment));
const TOKEN = 'msp_' + 'a'.repeat(43);
const bearer = (token: string, ip = 'ip-1') => new Request('https://app.test/api/v1/me', { headers: { authorization: `Bearer ${token}`, 'x-test-ip': ip } });
const keyRow = (over: object = {}) => ({ id: 'tok1', workspaceId: 'workspace-a', userId: 'user-a', scope: 'read', targetIds: null, expiresAt: new Date(now.getTime() + 86_400_000), revokedAt: null, lastUsedAt: null, disabledAt: null, suspendedAt: null, workspaceName: 'Acme', role: 'owner', ...over });

beforeEach(() => {
  vi.clearAllMocks(); resetRateLimit(); resetCapabilityCache();
  Object.assign(state, { queries: [], executions: [], handlers: [], role: 'owner', disabled: false, member: true, all: true, ids: ['t1'], devAccess: true, config: {}, columns: true, entitled: true });
  db.user.findUnique.mockImplementation(async () => ({ disabledAt: state.disabled ? new Date() : null }));
  db.membership.findUnique.mockImplementation(async () => (state.member ? { role: state.role } : null));
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = { sql: strings.join('?'), values }; state.queries.push(q);
    for (const [fragment, fn] of state.handlers) if (q.sql.includes(fragment)) return fn(values);
    if (q.sql.includes('information_schema')) return state.columns ? [{ column_name: 'expiresAt' }, { column_name: 'targetIds' }] : [];
    if (q.sql.includes('FROM memberships m JOIN users u')) return [{ role: state.role, disabledAt: state.disabled ? new Date() : null }];
    if (q.sql.includes('FROM targets')) return [{ id: 't1', name: 'Alpha' }, { id: 't2', name: 'Beta' }].filter(t => state.all || state.ids.includes(t.id));
    if (q.sql.includes('COUNT(*)')) return [{ count: BigInt(0) }];
    return [];
  });
  db.$executeRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => { state.executions.push({ sql: strings.join('?'), values }); return 1; });
});

describe('contracts', () => {
  it('matches the legacy key digest and shape, and the PKCE S256 vector', () => {
    expect(API_TOKEN_SHAPE.test(TOKEN)).toBe(true); expect(API_TOKEN_SHAPE.test('msp_short')).toBe(false);
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(s256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('accepts only exact-safe redirect addresses', () => {
    for (const ok of ['https://app.example.com/cb', 'http://localhost:8080/cb', 'http://127.0.0.1/cb']) expect(isAllowedRedirect(ok), ok).toBe(true);
    for (const bad of ['http://example.com/cb', 'https://example.com/cb#x', 'https://u:p@example.com/cb', 'javascript:alert(1)', 'nope']) expect(isAllowedRedirect(bad), bad).toBe(false);
  });
});

describe('API keys', () => {
  const ok = (over: object = {}) => ({ name: 'Script', scope: 'read', confirmation: confirmations.createToken('Script'), ...over });
  it('shows the key once, stores only its hash, sets an expiry and audits without the secret', async () => {
    const made = await createApiToken(actor, ok({ expiresInDays: 30 }), now);
    expect(made.token).toMatch(API_TOKEN_SHAPE);
    const insert = state.executions.find(q => q.sql.includes('INSERT INTO api_tokens'))!;
    expect(insert.values).toContain(sha256(made.token)); expect(insert.values).not.toContain(made.token);
    expect(insert.values).toContainEqual(new Date(now.getTime() + 30 * 86_400_000));
    expect(JSON.stringify(state.executions.filter(q => q.sql.includes('activity_logs')))).not.toContain(made.token);
    expect(audited('api_key.created')).toBe(true);
  });
  it('enforces exact confirmation, lifetime and count limits, the capability switch, role and missing columns', async () => {
    await expect(createApiToken(actor, ok({ confirmation: 'x' }), now)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(createApiToken(actor, ok({ scope: 'admin' }), now)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(createApiToken(actor, ok({ expiresInDays: 400 }), now)).rejects.toMatchObject({ code: 'invalid_request' });
    when('FROM api_tokens WHERE "workspaceId"', () => [{ count: BigInt(50) }]);
    await expect(createApiToken(actor, ok(), now)).rejects.toMatchObject({ code: 'conflict' });
    state.handlers.length = 0;
    state.role = 'editor'; await expect(createApiToken(actor, ok(), now)).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'owner'; state.config['integrations.api.enabled'] = false;
    await expect(createApiToken(actor, ok(), now)).rejects.toMatchObject({ code: 'unavailable' });
    state.config['integrations.api.enabled'] = true; state.columns = false; resetCapabilityCache();
    await expect(createApiToken(actor, ok(), now)).rejects.toMatchObject({ code: 'unavailable' });
    expect(wrote('INSERT INTO api_tokens')).toBe(false);
  });
  it('limits a key to channels its creator can reach; a scoped admin cannot create an unscoped write key', async () => {
    state.all = false; state.ids = ['t1'];
    await expect(createApiToken(actor, ok({ targetIds: ['t2'] }), now)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(createApiToken(actor, ok({ scope: 'write' }), now)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(createApiToken(actor, ok({ scope: 'write', targetIds: ['t1'], confirmation: confirmations.createToken('Script') }), now)).resolves.toBeTruthy();
    expect(state.executions.find(q => q.sql.includes('INSERT INTO api_tokens'))!.values).toContainEqual(['t1']);
  });
  it('lists without ever exposing hashes or values, and reports expiry status', async () => {
    when('FROM api_tokens t JOIN users', () => [{ id: 'a', name: 'k', prefix: 'msp_abcdef', scope: 'read', targetIds: ['t1', 'tX'], userName: 'Ann', createdAt: now, expiresAt: new Date(now.getTime() - 1), lastUsedAt: null, revokedAt: null }]);
    const view = await listApiTokens(actor, now);
    expect(view.tokens[0]).toMatchObject({ status: 'expired', targetNames: ['Alpha', 'Channel'] });
    expect(JSON.stringify(view)).not.toContain('tokenHash');
    expect(state.queries.find(q => q.sql.includes('FROM api_tokens t JOIN users'))!.values).toContain('workspace-a');
  });
  it('revokes inside the workspace, pauses subscribed webhooks, audits, is idempotent and hides foreign keys', async () => {
    when('FROM api_tokens WHERE id', () => []);
    await expect(revokeApiToken(actor, { id: 'other', confirmation: confirmations.revokeToken('other') }, now)).rejects.toMatchObject({ code: 'not_found' });
    state.handlers.length = 0;
    when('FROM api_tokens WHERE id', () => [{ id: 'tok1', revokedAt: null }]);
    await expect(revokeApiToken(actor, { id: 'tok1', confirmation: 'x' }, now)).rejects.toMatchObject({ code: 'invalid_request' });
    const done = await revokeApiToken(actor, { id: 'tok1', confirmation: confirmations.revokeToken('tok1') }, now);
    expect(done).toMatchObject({ revoked: true, alreadyRevoked: false, webhooksDisabled: 1 });
    expect(wrote('UPDATE webhook_endpoints SET enabled = false')).toBe(true); expect(audited('api_key.revoked')).toBe(true);
    state.handlers.length = 0; state.executions.length = 0;
    when('FROM api_tokens WHERE id', () => [{ id: 'tok1', revokedAt: now }]);
    expect(await revokeApiToken(actor, { id: 'tok1', confirmation: confirmations.revokeToken('tok1') }, now)).toMatchObject({ alreadyRevoked: true });
    expect(wrote('UPDATE api_tokens')).toBe(false);
  });
});

describe('REST v1 authentication', () => {
  it('accepts a valid key and acts as the owner with their live channel scope narrowed by the key', async () => {
    when('FROM api_tokens t JOIN users', () => [keyRow({ targetIds: ['t1', 't2'] })]);
    state.all = false; state.ids = ['t2', 't3'];
    const ctx = await authenticateApiKey(bearer(TOKEN), 'read', now);
    expect(ctx.actor).toEqual({ userId: 'user-a', workspaceId: 'workspace-a', allowedTargetIds: ['t2'] });
    expect(state.queries.find(q => q.sql.includes('FROM api_tokens t JOIN users'))!.values).toContain(sha256(TOKEN));
    expect(wrote('UPDATE api_tokens SET "lastUsedAt"')).toBe(true);
  });
  it('throttles last-used writes to the Root interval', async () => {
    when('FROM api_tokens t JOIN users', () => [keyRow({ lastUsedAt: new Date(now.getTime() - 5_000) })]);
    await authenticateApiKey(bearer(TOKEN), 'read', now);
    expect(wrote('UPDATE api_tokens SET "lastUsedAt"')).toBe(false);
  });
  it.each([
    ['revoked', { revokedAt: now }], ['expired', { expiresAt: new Date(now.getTime() - 1) }], ['legacy without expiry', { expiresAt: null }],
    ['disabled owner', { disabledAt: now }], ['suspended workspace', { suspendedAt: now }], ['removed member', { role: null }],
  ])('rejects a %s key with the same uninformative error', async (_label, over) => {
    when('FROM api_tokens t JOIN users', () => [keyRow(over)]);
    await expect(authenticateApiKey(bearer(TOKEN), 'read', now)).rejects.toMatchObject({ code: 'unauthorized', message: expect.stringContaining('valid API key') });
  });
  it('accepts migrated keys without expiry only while Root allows them', async () => {
    when('FROM api_tokens t JOIN users', () => [keyRow({ expiresAt: null })]);
    state.config['integrations.api.allowNonExpiringLegacyKeys'] = true;
    await expect(authenticateApiKey(bearer(TOKEN), 'read', now)).resolves.toBeTruthy();
  });
  it('rejects unknown, malformed and missing credentials, a read key used to write, and a disabled capability or entitlement', async () => {
    await expect(authenticateApiKey(bearer(TOKEN), 'read', now)).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(authenticateApiKey(bearer('nope'), 'read', now)).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(authenticateApiKey(new Request('https://app.test/x'), 'read', now)).rejects.toMatchObject({ code: 'unauthorized' });
    when('FROM api_tokens t JOIN users', () => [keyRow()]);
    await expect(authenticateApiKey(bearer(TOKEN), 'write', now)).rejects.toMatchObject({ code: 'forbidden' });
    state.entitled = false; await expect(authenticateApiKey(bearer(TOKEN), 'read', now)).rejects.toMatchObject({ code: 'unauthorized' });
    state.entitled = true; state.config['integrations.api.enabled'] = false;
    await expect(authenticateApiKey(bearer(TOKEN), 'read', now)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('rate limits per key and throttles guessing per address', async () => {
    state.config['integrations.api.v1RatePerMinute'] = 2;
    when('FROM api_tokens t JOIN users', () => [keyRow()]);
    await authenticateApiKey(bearer(TOKEN), 'read', now); await authenticateApiKey(bearer(TOKEN), 'read', now);
    await expect(authenticateApiKey(bearer(TOKEN), 'read', now)).rejects.toMatchObject({ name: 'RateLimited', retryAfterSeconds: expect.any(Number) });
    state.handlers.length = 0;
    await expect(authenticateApiKey(bearer('msp_' + 'b'.repeat(43), 'ip-9'), 'read', now)).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(authenticateApiKey(bearer('msp_' + 'c'.repeat(43), 'ip-9'), 'read', now)).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(authenticateApiKey(bearer('msp_' + 'd'.repeat(43), 'ip-9'), 'read', now)).rejects.toMatchObject({ name: 'RateLimited' });
  });
});

describe('REST hooks', () => {
  const ctx = (scope: 'read' | 'write') => ({ tokenId: 'tok1', scope, role: 'owner', workspaceName: 'Acme', actor: { userId: 'user-a', workspaceId: 'workspace-a' } });
  const body = { url: 'https://hooks.example.com/z', events: ['post.published'] };
  it('lets only a write key subscribe, tags the endpoint with the key, and returns the secret once', async () => {
    await expect(restSubscribe(ctx('read'), body)).rejects.toMatchObject({ code: 'forbidden' });
    const made = await restSubscribe(ctx('write'), body, { resolve: async () => ['93.184.216.34'] });
    expect(made.secret).toMatch(/^whsec_/);
    expect(state.executions.find(q => q.sql.includes('INSERT INTO webhook_endpoints'))!.values).toContain('tok1');
    await expect(restSubscribe(ctx('write'), { ...body, url: 'https://10.1.1.1/x' }, { resolve: async () => ['93.184.216.34'] })).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('unsubscribes only hooks made by the same key and never leaks another workspace', async () => {
    when('DELETE FROM webhook_endpoints', () => []);
    await expect(restUnsubscribe(ctx('write'), { id: 'foreign' })).rejects.toMatchObject({ code: 'not_found' });
    const del = state.queries.find(q => q.sql.includes('DELETE FROM webhook_endpoints'))!;
    expect(del.sql).toContain('"apiTokenId"'); expect(del.values).toEqual(expect.arrayContaining(['workspace-a', 'tok1']));
    await expect(restUnsubscribe(ctx('read'), { id: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('describes the key without revealing hashes', async () => {
    const me = await restMe({ ...ctx('write'), actor: { userId: 'u', workspaceId: 'workspace-a', allowedTargetIds: ['t1'] } });
    expect(me).toMatchObject({ scope: 'write', channels: ['t1'], maxPageSize: 100 });
  });
});

describe('OAuth connectors', () => {
  const challenge = s256('v'.repeat(50));
  const client = { id: 'oc1', name: 'Claude', redirectUris: ['https://claude.example.com/cb'] };
  const consent = (over: object = {}) => ({ clientId: 'oc1', redirectUri: 'https://claude.example.com/cb', codeChallenge: challenge, codeChallengeMethod: 'S256', scope: 'read', confirmation: confirmations.authorizeConnector('oc1'), ...over });
  it('registers within Root bounds, validates addresses, throttles per caller and audits at installation level', async () => {
    const made = await registerClient({ client_name: 'Claude', redirect_uris: ['https://claude.example.com/cb', 'https://claude.example.com/cb'] }, 'ip-1', now);
    expect(made).toMatchObject({ client_name: 'Claude', redirect_uris: ['https://claude.example.com/cb'], token_endpoint_auth_method: 'none' });
    expect(wrote('INSERT INTO root_activities')).toBe(true);
    await expect(registerClient({ client_name: 'x', redirect_uris: ['http://evil.example.com/cb'] }, 'ip-2', now)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(registerClient({ client_name: 'x', redirect_uris: [] }, 'ip-2', now)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(registerClient({ client_name: 'x', redirect_uris: Array.from({ length: 11 }, (_, i) => `https://a.example.com/${i}`) }, 'ip-2', now)).rejects.toMatchObject({ code: 'invalid_request' });
    when('FROM "OAuthClient"', () => [{ count: BigInt(500) }]);
    await expect(registerClient({ client_name: 'x', redirect_uris: ['https://a.example.com/cb'] }, 'ip-3', now)).rejects.toMatchObject({ code: 'unavailable' });
    state.config['integrations.oauth.registrationsPerHour'] = 1;
    await registerClient({ client_name: 'x', redirect_uris: ['http://localhost/cb'] }, 'ip-4', now).catch(() => undefined);
    await expect(registerClient({ client_name: 'x', redirect_uris: ['http://localhost/cb'] }, 'ip-4', now)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('requires an exact registered redirect address (no prefix, case or path tricks)', async () => {
    when('FROM "OAuthClient"', () => [client]);
    await expect(describeClientForConsent('oc1', 'https://claude.example.com/cb')).resolves.toMatchObject({ name: 'Claude', redirectHost: 'claude.example.com' });
    for (const uri of ['https://claude.example.com/cb/', 'https://claude.example.com/cb2', 'https://CLAUDE.example.com/cb', 'https://claude.example.com.evil.com/cb', 'https://claude.example.com/cb?x=1']) {
      await expect(describeClientForConsent('oc1', uri), uri).rejects.toMatchObject({ code: 'invalid_request' });
    }
  });
  it('records consent only for owners/admins, hashes the code, expires it, and builds the redirect with state', async () => {
    when('FROM "OAuthClient"', () => [client]);
    const done = await authorizeConnector(actor, consent({ state: 'xyz' }), now);
    const url = new URL(done.redirectTo);
    expect(url.origin + url.pathname).toBe('https://claude.example.com/cb'); expect(url.searchParams.get('state')).toBe('xyz');
    const code = url.searchParams.get('code')!;
    const insert = state.executions.find(q => q.sql.includes('INSERT INTO "OAuthCode"'))!;
    expect(insert.values).toContain(sha256(code)); expect(insert.values).not.toContain(code);
    expect(insert.values).toContainEqual(new Date(now.getTime() + 300_000)); expect(audited('oauth.consent_granted')).toBe(true);
    state.role = 'editor'; await expect(authorizeConnector(actor, consent(), now)).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'owner';
    await expect(authorizeConnector(actor, consent({ confirmation: 'x' }), now)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(authorizeConnector(actor, consent({ codeChallengeMethod: 'plain' }), now)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(authorizeConnector(actor, consent({ redirectUri: 'https://claude.example.com/other' }), now)).rejects.toMatchObject({ code: 'invalid_request' });
  });
  describe('code exchange', () => {
    const verifier = 'v'.repeat(50);
    const grant = (over: object = {}) => ({ grant_type: 'authorization_code', code: 'c'.repeat(43), client_id: 'oc1', redirect_uri: 'https://claude.example.com/cb', code_verifier: verifier, ...over });
    const stored = (over: object = {}) => [{ clientId: 'oc1', userId: 'user-a', workspaceId: 'workspace-a', redirectUri: 'https://claude.example.com/cb', codeChallenge: s256(verifier), scope: 'read', expiresAt: new Date(now.getTime() + 60_000), name: 'Claude', ...over }];
    it('swaps a valid code once for an expiring key and burns the code before verifying', async () => {
      when('DELETE FROM "OAuthCode"', () => stored());
      const token = await exchangeCode(grant(), now);
      expect(token).toMatchObject({ token_type: 'Bearer', scope: 'read' }); expect(token.access_token).toMatch(API_TOKEN_SHAPE); expect(token.expires_in).toBe(90 * 86_400);
      expect(state.queries.find(q => q.sql.includes('DELETE FROM "OAuthCode"'))!.values).toContain(sha256('c'.repeat(43)));
      expect(state.executions.find(q => q.sql.includes('INSERT INTO api_tokens'))!.values).toContain('Claude (connector)');
    });
    it.each([
      ['unknown or used code', () => [], {}], ['expired code', () => stored({ expiresAt: new Date(now.getTime() - 1) }), {}],
      ['other client', () => stored(), { client_id: 'oc2' }], ['other redirect', () => stored(), { redirect_uri: 'https://claude.example.com/cb2' }],
      ['wrong verifier', () => stored(), { code_verifier: 'w'.repeat(50) }],
    ])('refuses a %s and mints nothing', async (_l, rows, over) => {
      when('DELETE FROM "OAuthCode"', rows);
      await expect(exchangeCode(grant(over), now)).rejects.toMatchObject({ code: 'invalid_request' });
      expect(wrote('INSERT INTO api_tokens')).toBe(false);
    });
    it('refuses when the person lost authority since consent, or the grant type or fields are wrong', async () => {
      when('DELETE FROM "OAuthCode"', () => stored());
      state.role = 'viewer'; state.devAccess = false;
      await expect(exchangeCode(grant(), now)).rejects.toMatchObject({ code: 'invalid_request' });
      state.role = 'owner'; state.devAccess = true; state.disabled = true;
      await expect(exchangeCode(grant(), now)).rejects.toMatchObject({ code: 'invalid_request' });
      state.disabled = false;
      await expect(exchangeCode(grant({ grant_type: 'password' }), now)).rejects.toMatchObject({ code: 'invalid_request' });
      await expect(exchangeCode(grant({ extra: 1 }), now)).rejects.toMatchObject({ code: 'invalid_request' });
      expect(wrote('INSERT INTO api_tokens')).toBe(false);
    });
  });
});
