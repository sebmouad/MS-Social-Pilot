import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationError } from '../src/lib/operation-error';

type Q = { sql: string; values: unknown[] };
type CodeRow = { id: string; codeHash: string; clientId: string; userId: string; workspaceId: string; redirectUri: string; codeChallenge: string; readFeatures: string[]; writeFeatures: string[]; resourceScope: unknown; expiresAt: number; usedAt: number | null; keyId: string | null };
const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>, executions: [] as Q[], clients: [] as Array<{ id: string; name: string; redirectUris: string[] }>, codes: [] as CodeRow[], clientCount: 0,
  issued: [] as unknown[], issueFails: false, viewer: null as null | Record<string, unknown>, viewerRedirect: null as null | string, now: Date.now(),
}));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), target: { findMany: vi.fn() }, adAccount: { findMany: vi.fn() } }));
vi.mock('@/server/data', () => ({ prisma: db, getSessionByTokenHash: vi.fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => (key in state.config ? state.config[key] : key === 'mcp.keys.maxLifetimeDays' ? 365 : DEFAULTS[key]) }));
vi.mock('@/modules/settings/mcp-access/server', () => ({
  issueMcpKey: vi.fn(async (actor: unknown, input: { name: string }) => {
    if (state.issueFails) throw new OperationError('forbidden', 'API key management is unavailable with your current access.');
    state.issued.push({ actor, input });
    return { key: { id: 'mcpkey_issued1', name: input.name, expiresAt: new Date(Date.now() + 30 * 86400000) }, token: 'mcp_' + 'A'.repeat(43) };
  }),
}));
vi.mock('@/server/context', () => ({
  requireViewer: async () => {
    if (state.viewerRedirect) throw Object.assign(new Error('redirect'), { digest: `NEXT_REDIRECT;replace;${state.viewerRedirect};307;` });
    return state.viewer;
  },
}));
vi.mock('@/server/entitlements', () => ({ canUseFeature: () => true, entitledPlatformIds: () => ['facebook'] }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('@/server/mcp/server', () => ({ workspaceMcpFeatureIds: () => ['publishing/posts', 'inbox/conversations', 'analytics/overview'] }));
vi.mock('@/server/platforms/resource-visibility', () => ({ selectedResourceConnectionWhere: async () => ({ workspaceId: 'ws1' }) }));
vi.mock('@/server/client-ip', () => ({ clientIp: () => '203.0.113.9' }));

import { INTEGRATIONS_CONFIG } from '../src/modules/integrations/config';
const DEFAULTS: Record<string, unknown> = Object.fromEntries(INTEGRATIONS_CONFIG.map(item => [item.key, item.defaultValue]));
import { authorizeParamsSchema, authorizeParamsSchemaForLimits, cleanClientName, isAllowedRedirect, pkceMatches, redirectRegistered, registrationSchema, registrationSchemaForLimits, s256, safeEqual, sameOrigin } from '../src/modules/integrations/oauth/protocol';
import { createAuthorizationCode, exchangeCode, findClient, registerClient } from '../src/modules/integrations/oauth/server';
import { POST as consentPost } from '../src/app/api/oauth/authorize/route';
import { POST as tokenPost } from '../src/app/api/oauth/token/route';
import { POST as registerPost } from '../src/app/api/oauth/register/route';
import { GET as asMetadata } from '../src/app/.well-known/oauth-authorization-server/route';
import { GET as prMetadata } from '../src/app/.well-known/oauth-protected-resource/[[...path]]/route';
import { reset as resetRateLimit } from '../src/server/rate-limit';

const ISSUER = 'https://app.example.test';
const CLIENT = 'oc_AAAAAAAAAAAAAAAAAAAAAAAA';
const REDIRECT = 'https://claude.example.test/callback';
const VERIFIER = 'v'.repeat(50);
const CHALLENGE = s256(VERIFIER);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const enable = () => { state.config['integrations.oauth.enabled'] = true; state.config['integrations.oauth.issuerUrl'] = ISSUER; };
const executed = (fragment: string) => state.executions.filter(q => q.sql.includes(fragment));

function addCode(overrides: Partial<CodeRow> = {}, code = 'code-plain-1') {
  const row: CodeRow = { id: 'ocode_1', codeHash: sha(code), clientId: CLIENT, userId: 'user-a', workspaceId: 'ws1', redirectUri: REDIRECT, codeChallenge: CHALLENGE, readFeatures: ['publishing/posts'], writeFeatures: [], resourceScope: { version: 1, mode: 'selected', ids: ['t1'], adAccountIds: [] }, expiresAt: state.now + 60000, usedAt: null, keyId: null, ...overrides };
  state.codes.push(row);
  return code;
}

beforeEach(() => {
  vi.clearAllMocks(); resetRateLimit();
  Object.assign(state, { config: {}, executions: [], clients: [{ id: CLIENT, name: 'Claude', redirectUris: [REDIRECT] }], codes: [], clientCount: 0, issued: [], issueFails: false, viewerRedirect: null, now: Date.now() });
  state.viewer = {
    user: { id: 'user-a' }, membership: { role: 'owner', workspace: { name: 'Acme' } }, workspaceId: 'ws1', entitlements: {}, permissions: { pageScope: { all: true, ids: [] } },
  };
  db.target.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter(id => id.startsWith('t')).map(id => ({ id })));
  db.adAccount.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter(id => id.startsWith('a')).map(id => ({ id })));
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('FROM mcp_oauth_clients WHERE id=')) return state.clients.filter(client => client.id === values[0]);
    if (sql.includes('COUNT(*)')) return [{ count: BigInt(state.clientCount) }];
    if (sql.includes('UPDATE mcp_oauth_codes SET "usedAt"')) {
      const row = state.codes.find(item => item.codeHash === values[0] && item.usedAt === null);
      if (!row) return [];
      row.usedAt = state.now;
      return [{ ...row, expired: row.expiresAt < state.now }];
    }
    if (sql.includes('FROM mcp_oauth_codes WHERE "codeHash"')) return state.codes.filter(item => item.codeHash === values[0]).map(row => ({ ...row, expired: false }));
    return [];
  });
  db.$executeRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = { sql: strings.join('?'), values };
    state.executions.push(q);
    if (q.sql.includes('INSERT INTO mcp_oauth_codes')) state.codes.push({ id: String(values[0]), codeHash: String(values[1]), clientId: String(values[2]), userId: String(values[3]), workspaceId: String(values[4]), redirectUri: String(values[5]), codeChallenge: String(values[6]), readFeatures: values[7] as string[], writeFeatures: values[8] as string[], resourceScope: JSON.parse(String(values[9])), expiresAt: state.now + 60000, usedAt: null, keyId: null });
    if (q.sql.includes('UPDATE mcp_oauth_codes SET "keyId"')) { const row = state.codes.find(item => item.id === values[1]); if (row) row.keyId = String(values[0]); }
    return 1;
  });
});

const form = (fields: Array<[string, string]>, origin: string | null = ISSUER) => new Request(`${ISSUER}/api/oauth/authorize`, {
  method: 'POST', headers: { ...(origin ? { origin } : {}), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(),
});
const base = (): Array<[string, string]> => [['client_id', CLIENT], ['redirect_uri', REDIRECT], ['response_type', 'code'], ['code_challenge', CHALLENGE], ['code_challenge_method', 'S256'], ['state', 'xyz 123&=?'], ['workspace_id', 'ws1']];
const tokenRequest = (fields: Record<string, string>, type = 'application/x-www-form-urlencoded') => new Request(`${ISSUER}/api/oauth/token`, { method: 'POST', headers: { 'content-type': type }, body: new URLSearchParams(fields).toString() });
const goodToken = (code: string) => ({ grant_type: 'authorization_code', code, client_id: CLIENT, redirect_uri: REDIRECT, code_verifier: VERIFIER });

describe('protocol rules', () => {
  it('registers only https redirects (http only on loopback) with no fragment, credentials or wildcards', () => {
    for (const ok of ['https://claude.ai/api/mcp/auth_callback', 'http://localhost:6274/cb', 'http://127.0.0.1/cb', 'http://[::1]:3000/cb']) expect(isAllowedRedirect(ok), ok).toBe(true);
    for (const bad of ['http://claude.ai/cb', 'javascript:alert(1)', 'myapp://cb', 'https://a.test/cb#x', 'https://u:p@a.test/cb', 'https://*.a.test/cb', '/relative', 'https://a.test/ cb', 'http://localhost.evil.test/cb', 'data:text/html,x']) expect(isAllowedRedirect(bad), bad).toBe(false);
    expect(registrationSchema.safeParse({ redirect_uris: [] }).success).toBe(false);
    expect(registrationSchema.safeParse({ redirect_uris: ['https://a.test/cb'], grant_types: ['implicit'] }).success).toBe(false);
    expect(registrationSchema.safeParse({ redirect_uris: ['https://a.test/cb'], response_types: ['token'] }).success).toBe(false);
    expect(registrationSchema.safeParse({ redirect_uris: Array.from({ length: 11 }, (_, i) => `https://a.test/${i}`) }).success).toBe(false);
  });
  it('matches redirect URIs exactly: no prefix, case, trailing-slash or query tolerance', () => {
    const registered = [REDIRECT];
    expect(redirectRegistered(registered, REDIRECT)).toBe(true);
    for (const near of [`${REDIRECT}/`, `${REDIRECT}?x=1`, REDIRECT.toUpperCase(), 'https://claude.example.test/callback2', 'https://claude.example.test.evil.test/callback', ' ' + REDIRECT]) expect(redirectRegistered(registered, near), near).toBe(false);
  });
  it('verifies PKCE S256 only, with verifier shape rules', () => {
    expect(pkceMatches(VERIFIER, CHALLENGE)).toBe(true);
    expect(pkceMatches('w'.repeat(50), CHALLENGE)).toBe(false);
    expect(pkceMatches('short', s256('short'))).toBe(false);
    expect(pkceMatches(VERIFIER, VERIFIER)).toBe(false); // plain method is never accepted
    expect(pkceMatches('v'.repeat(129), s256('v'.repeat(129)))).toBe(false);
  });
  it('compares secrets in constant time through fixed-size digests', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    const source = readFileSync('src/modules/integrations/oauth/protocol.ts', 'utf8');
    expect(source).toContain('timingSafeEqual');
    const server = readFileSync('src/modules/integrations/oauth/server.ts', 'utf8');
    expect(server).not.toMatch(/(clientId|redirectUri|codeChallenge|codeHash)\s*[!=]==/);
  });
  it('requires an explicit same-origin Origin for form posts', () => {
    const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
    expect(sameOrigin(h({ origin: ISSUER }), `${ISSUER}/api/oauth/authorize`, ISSUER)).toBe(true);
    expect(sameOrigin(h({}), `${ISSUER}/x`, ISSUER)).toBe(false);
    expect(sameOrigin(h({ origin: 'null' }), `${ISSUER}/x`, ISSUER)).toBe(false);
    expect(sameOrigin(h({ origin: 'https://evil.test' }), `${ISSUER}/x`, ISSUER)).toBe(false);
    expect(sameOrigin(h({ origin: 'https://app.example.test.evil.test' }), `${ISSUER}/x`, ISSUER)).toBe(false);
    expect(sameOrigin(h({ origin: ISSUER, 'sec-fetch-site': 'cross-site' }), `${ISSUER}/x`, ISSUER)).toBe(false);
  });
  it('strips control and bidirectional characters from client names', () => {
    expect(cleanClientName('Cl‮aude\u0000\n  Pro', 60, 'MCP client')).toBe('Claude Pro');
    expect(cleanClientName('   ', 60, 'MCP client')).toBe('MCP client');
    expect(cleanClientName('x'.repeat(200), 60, 'MCP client')).toHaveLength(60);
  });
  it('keeps compatibility parser defaults and exposes Root-limit schema factories', () => {
    const registration = { client_name: 'x'.repeat(201), redirect_uris: [REDIRECT] };
    expect(registrationSchema.safeParse(registration).success).toBe(false);
    expect(registrationSchemaForLimits({ clientNameInputMaxCharacters: 300, redirectUriMaxCharacters: 3000, redirectUrisMaxItems: 12 }).safeParse(registration).success).toBe(true);
    const params = { client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 's'.repeat(1001), scope: 's'.repeat(201) };
    expect(authorizeParamsSchema.safeParse(params).success).toBe(false);
    expect(authorizeParamsSchemaForLimits({ redirectUriMaxCharacters: 3000, authorizationStateMaxCharacters: 1500, scopeMaxCharacters: 300 }).safeParse(params).success).toBe(true);
    expect(isAllowedRedirect(`${REDIRECT}${'x'.repeat(2000)}`)).toBe(false);
  });
});

describe('Root configuration and discovery', () => {
  it('ships off by default with no issuer, and every key is consumed by the flow', () => {
    expect(DEFAULTS['integrations.oauth.enabled']).toBe(false);
    expect(DEFAULTS['integrations.oauth.issuerUrl']).toBe('');
    const issuer = INTEGRATIONS_CONFIG.find(item => item.key === 'integrations.oauth.issuerUrl')!;
    expect(issuer.schema.safeParse('https://app.example.test').success).toBe(true);
    expect(issuer.schema.safeParse('https://app.example.test/').success).toBe(false);
    expect(issuer.schema.safeParse('http://app.example.test').success).toBe(false);
    expect(issuer.schema.safeParse('http://localhost:3000').success).toBe(true);
    const source = readFileSync('src/modules/integrations/oauth/server.ts', 'utf8');
    for (const item of INTEGRATIONS_CONFIG.filter(entry => entry.key.startsWith('integrations.oauth.'))) expect(source, item.key).toContain(item.key);
  });
  it('serves discovery only while enabled, advertising S256 and public clients only', async () => {
    expect((await asMetadata()).status).toBe(404);
    expect((await prMetadata(new Request(`${ISSUER}/.well-known/oauth-protected-resource`), { params: Promise.resolve({}) })).status).toBe(404);
    enable();
    const meta = await (await asMetadata()).json();
    expect(meta).toMatchObject({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/oauth/authorize`, token_endpoint: `${ISSUER}/api/oauth/token`, registration_endpoint: `${ISSUER}/api/oauth/register`, code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], grant_types_supported: ['authorization_code'] });
    const resource = await prMetadata(new Request(`${ISSUER}/.well-known/oauth-protected-resource/api/mcp`), { params: Promise.resolve({ path: ['api', 'mcp'] }) });
    expect(await resource.json()).toMatchObject({ resource: `${ISSUER}/api/mcp`, authorization_servers: [ISSUER] });
    expect((await prMetadata(new Request(`${ISSUER}/x`), { params: Promise.resolve({ path: ['api', 'other'] }) })).status).toBe(404);
  });
});

describe('dynamic client registration', () => {
  const post = (body: unknown) => registerPost(new Request(`${ISSUER}/api/oauth/register`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
  it('is refused while disabled, then stores a client and audits it', async () => {
    expect((await post({ redirect_uris: [REDIRECT] })).status).toBe(503);
    enable();
    const response = await post({ client_name: 'Claude', redirect_uris: [REDIRECT, REDIRECT] });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toMatchObject({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' });
    expect(body.client_id).toMatch(/^oc_/);
    expect(body).not.toHaveProperty('client_secret');
    expect(executed('INSERT INTO mcp_oauth_clients')).toHaveLength(1);
    expect(executed('root_activities').some(q => q.values.includes('oauth.client_registered'))).toBe(true);
  });
  it('accepts the historical 200-character name input and keeps the separate 60-character display cap', async () => {
    enable();
    const response = await post({ client_name: 'C'.repeat(100), redirect_uris: [REDIRECT] });
    expect(response.status).toBe(201);
    expect((await response.json()).client_name).toBe('C'.repeat(60));
    expect(executed('INSERT INTO mcp_oauth_clients').at(-1)?.values[1]).toBe('C'.repeat(60));
  });
  it('uses Root copy for empty client names and the key-name prefix', async () => {
    enable(); state.config['integrations.oauth.defaultClientName'] = 'Unnamed app';
    const response = await post({ client_name: '   ', redirect_uris: [REDIRECT] });
    expect(response.status).toBe(201);
    expect((await response.json()).client_name).toBe('Unnamed app');
  });
  it('enforces current Root client name, redirect count and redirect size limits', async () => {
    enable();
    state.config['integrations.oauth.clientNameInputMaxCharacters'] = 3;
    expect((await post({ client_name: 'Claude', redirect_uris: [REDIRECT] })).status).toBe(400);
    state.config['integrations.oauth.clientNameInputMaxCharacters'] = 200;
    state.config['integrations.oauth.clientNameMaxCharacters'] = 3;
    expect((await post({ client_name: 'Claude', redirect_uris: [REDIRECT] })).status).toBe(201);
    expect(executed('INSERT INTO mcp_oauth_clients').at(-1)?.values[1]).toBe('Cla');
    state.config['integrations.oauth.clientNameMaxCharacters'] = 60;
    state.executions.length = 0;
    state.config['integrations.oauth.redirectUrisMaxItems'] = 1;
    expect((await post({ redirect_uris: [REDIRECT, 'https://other.test/cb'] })).status).toBe(400);
    state.config['integrations.oauth.redirectUrisMaxItems'] = 10;
    state.config['integrations.oauth.redirectUriMaxCharacters'] = 10;
    expect((await post({ redirect_uris: [REDIRECT] })).status).toBe(400);
    expect(executed('INSERT INTO mcp_oauth_clients')).toHaveLength(0);
  });
  it('rejects unsafe redirect URIs, bad JSON and oversized bodies without storing anything', async () => {
    enable();
    for (const body of [{ redirect_uris: ['http://evil.test/cb'] }, { redirect_uris: ['javascript:alert(1)'] }, '{nope', { client_name: 'x' }]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('invalid_client_metadata');
    }
    expect((await post(JSON.stringify({ redirect_uris: [REDIRECT], pad: 'x'.repeat(9000) }))).status).toBe(400);
    expect(executed('INSERT INTO mcp_oauth_clients')).toHaveLength(0);
  });
  it('rate limits registrations and caps the client table', async () => {
    enable(); state.config['integrations.oauth.registrationsPerHour'] = 2;
    expect((await post({ redirect_uris: [REDIRECT] })).status).toBe(201);
    expect((await post({ redirect_uris: [REDIRECT] })).status).toBe(201);
    expect((await post({ redirect_uris: [REDIRECT] })).status).toBe(429);
    resetRateLimit(); state.config['integrations.oauth.maxClients'] = 5; state.clientCount = 5;
    expect((await post({ redirect_uris: [REDIRECT] })).status).toBe(503);
  });
});

describe('consent decision (POST /api/oauth/authorize)', () => {
  const location = (response: Response) => new URL(response.headers.get('location')!);
  it('refuses cross-origin and Origin-less posts before touching anything (CSRF)', async () => {
    enable();
    for (const origin of ['https://evil.test', 'null', null]) {
      const response = await consentPost(form([...base(), ['decision', 'allow'], ['read', 'publishing/posts'], ['mode', 'all']], origin));
      expect(response.status).toBe(403);
      expect(response.headers.get('location')).toBeNull();
    }
    expect(executed('INSERT INTO mcp_oauth_codes')).toHaveLength(0);
  });
  it('refuses when signed out or not an owner/admin, and when OAuth is off', async () => {
    expect((await consentPost(form([...base(), ['decision', 'allow']]))).status).toBe(503);
    enable();
    state.viewerRedirect = '/sign-in';
    expect((await consentPost(form([...base(), ['decision', 'allow']]))).status).toBe(401);
    state.viewerRedirect = null;
    (state.viewer as { membership: { role: string } }).membership.role = 'contributor';
    expect((await consentPost(form([...base(), ['decision', 'allow']]))).status).toBe(403);
    expect(executed('INSERT INTO mcp_oauth_codes')).toHaveLength(0);
  });
  it('never redirects to an unregistered redirect address or an unknown client', async () => {
    enable();
    for (const change of [['redirect_uri', 'https://evil.test/cb'], ['redirect_uri', `${REDIRECT}/`], ['client_id', 'oc_BBBBBBBBBBBBBBBBBBBBBBBB']] as const) {
      const fields = base().map(([k, v]) => [k, k === change[0] ? change[1] : v] as [string, string]);
      const response = await consentPost(form([...fields, ['decision', 'deny']]));
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers.get('location')).toBeNull();
    }
  });
  it('requires S256 PKCE parameters', async () => {
    enable();
    for (const [key, value] of [['code_challenge_method', 'plain'], ['code_challenge', 'short'], ['response_type', 'token']] as const) {
      const fields = base().map(([k, v]) => [k, k === key ? value : v] as [string, string]);
      const response = await consentPost(form([...fields, ['decision', 'allow'], ['read', 'publishing/posts'], ['mode', 'all']]));
      expect(response.headers.get('location')).toBeNull();
    }
  });
  it('passes state through unchanged on deny and allow, adds iss, and audits both', async () => {
    enable();
    const denied = await consentPost(form([...base(), ['decision', 'deny']]));
    expect(denied.status).toBe(303);
    expect(location(denied).origin + location(denied).pathname).toBe(REDIRECT);
    expect(location(denied).searchParams.get('error')).toBe('access_denied');
    expect(location(denied).searchParams.get('state')).toBe('xyz 123&=?');
    const allowed = await consentPost(form([...base(), ['decision', 'allow'], ['read', 'publishing/posts'], ['mode', 'selected'], ['target', 't1']]));
    expect(allowed.status).toBe(303);
    const url = location(allowed);
    expect(url.searchParams.get('state')).toBe('xyz 123&=?');
    expect(url.searchParams.get('iss')).toBe(ISSUER);
    expect(url.searchParams.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(executed('activity_logs').map(q => q.values.find(v => typeof v === 'string' && v.startsWith('oauth.')))).toEqual(['oauth.consent_denied', 'oauth.consent_granted']);
  });
  it('stores the code only as a SHA-256 hash with the narrow choice bound to client, redirect and challenge', async () => {
    enable();
    const response = await consentPost(form([...base(), ['decision', 'allow'], ['read', 'publishing/posts'], ['read', 'inbox/conversations'], ['write', 'inbox/conversations'], ['mode', 'selected'], ['target', 't1'], ['adAccount', 'a1']]));
    if (response.status !== 303) throw new Error(await response.text());
    const code = location(response).searchParams.get('code')!;
    const insert = executed('INSERT INTO mcp_oauth_codes')[0];
    expect(insert.values).toContain(sha(code));
    expect(insert.values).not.toContain(code);
    expect(JSON.stringify(state.executions.map(q => q.values))).not.toContain(code);
    const row = state.codes[0];
    expect(row).toMatchObject({ clientId: CLIENT, userId: 'user-a', workspaceId: 'ws1', redirectUri: REDIRECT, codeChallenge: CHALLENGE, readFeatures: ['publishing/posts', 'inbox/conversations'], writeFeatures: ['inbox/conversations'], resourceScope: { version: 1, mode: 'selected', ids: ['t1'], adAccountIds: ['a1'] } });
  });
  it('refuses a decision made for another workspace than the viewer\'s current one', async () => {
    enable();
    const fields = base().map(([k, v]) => [k, k === 'workspace_id' ? 'ws-other' : v] as [string, string]);
    const response = await consentPost(form([...fields, ['decision', 'allow'], ['read', 'publishing/posts'], ['mode', 'all']]));
    expect(response.status).toBe(403);
    expect(response.headers.get('location')).toBeNull();
    expect(executed('INSERT INTO mcp_oauth_codes')).toHaveLength(0);
  });
  it('refuses Root, unknown or unlisted features and write without read, so no Root scope can be requested', async () => {
    enable();
    for (const extra of [[['read', 'root/overview']], [['read', 'root']], [['read', 'settings/webhooks']], [['write', 'publishing/posts']], [['read', 'publishing/posts'], ['write', 'inbox/conversations']], []] as Array<Array<[string, string]>>) {
      const response = await consentPost(form([...base(), ['decision', 'allow'], ['mode', 'all'], ...extra]));
      expect(response.headers.get('location'), JSON.stringify(extra)).toBeNull();
    }
    expect(executed('INSERT INTO mcp_oauth_codes')).toHaveLength(0);
    expect(readFileSync('src/app/api/oauth/authorize/route.ts', 'utf8')).not.toMatch(/isInstanceOwner|rootAccess|'root'/);
  });
  it('limits channel choices to what the person can access, never defaults to all and needs an explicit pick', async () => {
    enable();
    (state.viewer as { permissions: unknown }).permissions = { pageScope: { all: false, ids: ['t1'] } };
    const attempt = (extra: Array<[string, string]>) => consentPost(form([...base(), ['decision', 'allow'], ['read', 'publishing/posts'], ...extra]));
    expect((await attempt([['mode', 'all']])).headers.get('location')).toBeNull();
    expect((await attempt([['mode', 'selected'], ['target', 't2']])).headers.get('location')).toBeNull();
    expect((await attempt([['mode', 'selected'], ['adAccount', 'a1'], ['target', 't1']])).headers.get('location')).toBeNull();
    expect((await attempt([['mode', 'selected']])).headers.get('location')).toBeNull();
    expect((await attempt([['target', 't1']])).headers.get('location')).toContain('code='); // the default mode is selected, never all
    expect((await attempt([['mode', 'selected'], ['target', 't1']])).headers.get('location')).toContain('code=');
  });
  it('rate limits decisions per person', async () => {
    enable(); state.config['integrations.oauth.consentsPerHour'] = 2;
    for (let i = 0; i < 2; i += 1) expect((await consentPost(form([...base(), ['decision', 'deny']]))).status).toBe(303);
    expect((await consentPost(form([...base(), ['decision', 'deny']]))).status).toBe(429);
  });
});

describe('token endpoint', () => {
  it('rejects wrong content type, unknown grants and missing fields', async () => {
    enable();
    expect((await tokenPost(tokenRequest(goodToken('c'), 'application/json'))).status).toBe(400);
    const grant = await tokenPost(tokenRequest({ ...goodToken('c'), grant_type: 'refresh_token' }));
    expect((await grant.json()).error).toBe('unsupported_grant_type');
    expect((await tokenPost(tokenRequest({ grant_type: 'authorization_code', code: 'c' }))).status).toBe(400);
    expect((await tokenPost(tokenRequest(goodToken('c')))).status).toBe(400); // unknown code
  });
  it('exchanges a good code once for a scoped key, with no-store and no refresh token', async () => {
    enable(); const code = addCode({ readFeatures: ['publishing/posts', 'inbox/conversations'], writeFeatures: ['inbox/conversations'] });
    const response = await tokenPost(tokenRequest(goodToken(code)));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toMatchObject({ token_type: 'Bearer', scope: 'read write' });
    expect(body.access_token).toMatch(/^mcp_/);
    expect(body).not.toHaveProperty('refresh_token');
    expect(state.issued).toHaveLength(1);
    expect(state.issued[0]).toMatchObject({ actor: { userId: 'user-a', workspaceId: 'ws1' }, input: { name: 'OAuth: Claude', readFeatures: ['publishing/posts', 'inbox/conversations'], writeFeatures: ['inbox/conversations'], expiresInDays: 30, resourceScope: { mode: 'selected', ids: ['t1'] }, confirmation: 'CREATE MCP KEY OAuth: Claude' } });
    expect(state.codes[0].keyId).toBe('mcpkey_issued1');
    expect(executed('activity_logs').some(q => q.values.includes('oauth.token_issued'))).toBe(true);
  });
  it('caps the key lifetime at the maximum API key lifetime', async () => {
    enable(); state.config['integrations.oauth.keyLifetimeDays'] = 300; state.config['mcp.keys.maxLifetimeDays'] = 7;
    await tokenPost(tokenRequest(goodToken(addCode())));
    expect((state.issued[0] as { input: { expiresInDays: number } }).input.expiresInDays).toBe(7);
  });
  it('reuse is refused and revokes the key the first exchange produced', async () => {
    enable(); const code = addCode();
    expect((await tokenPost(tokenRequest(goodToken(code)))).status).toBe(200);
    const again = await tokenPost(tokenRequest(goodToken(code)));
    expect(again.status).toBe(400);
    expect((await again.json()).error).toBe('invalid_grant');
    const revoke = executed('UPDATE mcp_api_keys SET "revokedAt"');
    expect(revoke).toHaveLength(1);
    expect(revoke[0].values).toContain('mcpkey_issued1');
    expect(executed('activity_logs').some(q => q.values.includes('oauth.code_reuse_revoked'))).toBe(true);
    expect(state.issued).toHaveLength(1);
  });
  it('a wrong verifier is refused and burns the code, so the real client cannot be raced', async () => {
    enable(); const code = addCode();
    const bad = await tokenPost(tokenRequest({ ...goodToken(code), code_verifier: 'w'.repeat(50) }));
    expect((await bad.json()).error).toBe('invalid_grant');
    expect((await tokenPost(tokenRequest(goodToken(code)))).status).toBe(400);
    expect(state.issued).toHaveLength(0);
  });
  it('binds the code to its client and exact redirect and refuses expired codes', async () => {
    enable();
    for (const change of [{ client_id: 'oc_BBBBBBBBBBBBBBBBBBBBBBBB' }, { redirect_uri: `${REDIRECT}/` }, { redirect_uri: 'https://evil.test/cb' }]) {
      const code = addCode({ id: `c${state.codes.length}`, codeHash: sha(`code-${state.codes.length}`) }, `code-${state.codes.length}`);
      expect((await tokenPost(tokenRequest({ ...goodToken(code), ...change }))).status).toBe(400);
    }
    const old = addCode({ id: 'old', codeHash: sha('old-code'), expiresAt: state.now - 1000 }, 'old-code');
    expect((await tokenPost(tokenRequest(goodToken(old)))).status).toBe(400);
    expect(state.issued).toHaveLength(0);
  });
  it('refuses when the person lost access since consent (issuance ceilings apply at exchange)', async () => {
    enable(); state.issueFails = true;
    const response = await tokenPost(tokenRequest(goodToken(addCode())));
    expect((await response.json()).error).toBe('invalid_grant');
    expect(state.issued).toHaveLength(0);
  });
  it('uses the current Root issued-key name ceiling', async () => {
    enable(); state.config['integrations.oauth.issuedKeyNameMaxCharacters'] = 5; state.config['integrations.oauth.issuedKeyNamePrefix'] = 'Agent: ';
    const response = await tokenPost(tokenRequest(goodToken(addCode())));
    expect(response.status).toBe(200);
    expect((state.issued[0] as { input: { name: string } }).input.name).toBe('Agent');
  });
  it('rate limits token requests per client and address', async () => {
    enable(); state.config['integrations.oauth.tokenAttemptsPerMinute'] = 2;
    const statuses = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await tokenPost(tokenRequest(goodToken(`nope-${i}`)))).status);
    expect(statuses).toEqual([400, 400, 429]);
  });
  it('is unavailable while disabled', async () => {
    expect((await tokenPost(tokenRequest(goodToken(addCode())))).status).toBe(503);
  });
});

describe('direct service guards', () => {
  it('createAuthorizationCode revalidates client and redirect even if called directly', async () => {
    enable();
    await expect(createAuthorizationCode({ userId: 'u', workspaceId: 'w' }, { clientId: CLIENT, redirectUri: 'https://evil.test/cb', codeChallenge: CHALLENGE, readFeatures: ['publishing/posts'], writeFeatures: [], resourceScope: { version: 1, mode: 'all' } })).rejects.toMatchObject({ code: 'invalid_request' });
    state.config['integrations.oauth.resourceIdMaxCharacters'] = 1;
    await expect(createAuthorizationCode({ userId: 'u', workspaceId: 'w' }, { clientId: CLIENT, redirectUri: REDIRECT, codeChallenge: CHALLENGE, readFeatures: ['publishing/posts'], writeFeatures: [], resourceScope: { version: 1, mode: 'selected', ids: ['t1'], adAccountIds: [] } })).rejects.toMatchObject({ code: 'invalid_request' });
    state.config['integrations.oauth.resourceIdMaxCharacters'] = 100;
    state.config['integrations.oauth.resourceIdsMaxItems'] = 1;
    await expect(createAuthorizationCode({ userId: 'u', workspaceId: 'w' }, { clientId: CLIENT, redirectUri: REDIRECT, codeChallenge: CHALLENGE, readFeatures: ['publishing/posts'], writeFeatures: [], resourceScope: { version: 1, mode: 'selected', ids: ['t1', 't2'], adAccountIds: [] } })).rejects.toMatchObject({ code: 'invalid_request' });
    state.config['integrations.oauth.resourceIdsMaxItems'] = 1000;
    state.config['integrations.oauth.redirectUriMaxCharacters'] = 10;
    await expect(createAuthorizationCode({ userId: 'u', workspaceId: 'w' }, { clientId: CLIENT, redirectUri: REDIRECT, codeChallenge: CHALLENGE, readFeatures: ['publishing/posts'], writeFeatures: [], resourceScope: { version: 1, mode: 'all' } })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(createAuthorizationCode({ userId: 'u', workspaceId: 'w' }, { clientId: CLIENT, redirectUri: REDIRECT, codeChallenge: CHALLENGE, readFeatures: ['root/overview'], writeFeatures: [], resourceScope: { version: 1, mode: 'all' } })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(findClient('not-a-client')).resolves.toBeNull();
    await expect(registerClient({ redirect_uris: ['http://evil.test'] }, null)).rejects.toMatchObject({ code: 'invalid_client_metadata' });
    await expect(exchangeCode({ code: 'x', clientId: CLIENT, redirectUri: REDIRECT, verifier: VERIFIER }, null)).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});

describe('source and migration properties', () => {
  const read = (path: string) => readFileSync(path, 'utf8');
  it('has no refresh tokens (legacy had none) and no native confirm dialogs', () => {
    const files = ['server.ts', 'protocol.ts', 'http.ts', 'ui/ConsentForm.tsx', 'ui/AuthorizeScreen.tsx'].map(file => read(`src/modules/integrations/oauth/${file}`)).join('\n');
    expect(files).not.toMatch(/refresh_token|window\.confirm/);
    expect(read('src/modules/integrations/oauth/ui/ConsentForm.tsx')).toContain("from '@/components/useConfirm'");
  });
  it('ships an additive migration that stores only hashes and cannot touch existing tables', () => {
    const dir = readdirSync('../prisma/migrations').find(name => name.endsWith('_rebuild_oauth_connectors'))!;
    const sql = read(`../prisma/migrations/${dir}/migration.sql`);
    expect(sql.match(/CREATE TABLE /g)).toHaveLength(2);
    expect(sql).not.toMatch(/\b(ALTER TABLE|DROP|TRUNCATE|INSERT INTO|UPDATE "|DELETE FROM)/i);
    expect(sql).toContain('"codeHash" TEXT NOT NULL');
    expect(sql).not.toMatch(/"(code|token|secret)" /);
    expect(sql).toContain('CREATE UNIQUE INDEX "mcp_oauth_codes_codeHash_key"');
    expect(sql).toContain('"writeFeatures" <@ "readFeatures"');
  });
});
