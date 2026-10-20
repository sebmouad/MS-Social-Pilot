import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

/**
 * OAuth connectors end to end on the guarded loopback `_preview` database: registration, consent code, PKCE exchange
 * through the real Settings key issuance and authority loaders, bearer authentication of the issued key, and code
 * reuse revoking that key. Only Root configuration is supplied (registry defaults plus the OAuth switch).
 */
const url = process.env.REBUILD_PREVIEW_DATABASE_URL;
const shared = vi.hoisted(() => ({ client: undefined as unknown as Record<string, unknown>, overrides: {} as Record<string, unknown> }));
const proxy = vi.hoisted(() => () => ({ prisma: new Proxy({}, { get: (_t, key) => { const value = shared.client?.[key as string]; return typeof value === 'function' ? value.bind(shared.client) : value; } }) }));
vi.mock('../src/server/data', async () => ({ ...(await vi.importActual<object>('../src/server/data')), ...proxy() }));
vi.mock('@/server/data', async () => ({ ...(await vi.importActual<object>('../src/server/data')), ...proxy() }));
vi.mock('@/server/config/store', () => {
  let defaults: Record<string, unknown> | undefined;
  const runtimeConfig = async (key: string) => {
    if (key in shared.overrides) return shared.overrides[key];
    defaults ??= Object.fromEntries((await import('../src/lib/config/registry')).CONFIG_REGISTRY.map((e: { key: string; defaultValue: unknown }) => [e.key, e.defaultValue]));
    return defaults[key];
  };
  const runtimeConfigBatch = async (keys: readonly string[]) => Object.fromEntries(await Promise.all([...new Set(keys)].map(async key => [key, await runtimeConfig(key)])));
  return { runtimeConfig, runtimeConfigBatch, runtimeSecret: async () => null };
});

import { createAuthorizationCode, exchangeCode, registerClient } from '../src/modules/integrations/oauth/server';
import { authenticateBearerHeader } from '../src/server/mcp/bearer';

function isolated(value: string) {
  const parsed = new URL(value);
  if (process.env.NODE_ENV === 'production' || parsed.port !== '55432' || !['localhost', '127.0.0.1'].includes(parsed.hostname) || !decodeURIComponent(parsed.pathname).endsWith('_preview')) throw new Error('Only guarded loopback preview databases allowed.');
  return new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
}
const pkce = () => { const verifier = randomBytes(32).toString('base64url'); return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }; };
const redirect = 'https://client.example.test/callback';

describe.skipIf(!url)('OAuth connectors on real PostgreSQL', () => {
  let db: PrismaClient; let actor: { userId: string; workspaceId: string };
  const made = { clients: [] as string[], since: new Date() };
  beforeAll(async () => {
    db = isolated(url!); shared.client = db as unknown as Record<string, unknown>;
    Object.assign(shared.overrides, { 'integrations.oauth.enabled': true, 'integrations.oauth.issuerUrl': 'https://msp.example.test', 'mcp.enabled': true });
    const rows = await db.$queryRaw<Array<{ userId: string; workspaceId: string }>>`
      SELECT m."userId", m."workspaceId" FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId"
      WHERE m.role::text = 'owner' AND u."disabledAt" IS NULL AND w."suspendedAt" IS NULL ORDER BY m."createdAt" LIMIT 1`;
    if (!rows[0]) throw new Error('The preview database needs a synthetic active owner.');
    actor = rows[0];
  });
  afterAll(async () => {
    if (!db) return;
    await db.$executeRaw`DELETE FROM mcp_api_keys WHERE id IN (SELECT "keyId" FROM mcp_oauth_codes WHERE "clientId" = ANY(${made.clients}::text[]) AND "keyId" IS NOT NULL)`;
    await db.$executeRaw`DELETE FROM mcp_oauth_codes WHERE "clientId" = ANY(${made.clients}::text[])`;
    await db.$executeRaw`DELETE FROM mcp_oauth_clients WHERE id = ANY(${made.clients}::text[])`;
    await db.$executeRaw`DELETE FROM activity_logs WHERE "createdAt" >= ${made.since} AND (action LIKE 'oauth.%' OR action LIKE 'mcp.key%' OR action LIKE 'settings.mcp%')`;
    await db.$executeRaw`DELETE FROM root_activities WHERE "createdAt" >= ${made.since} AND action LIKE 'oauth.%'`;
    await db.$disconnect();
  });

  it('registers, consents, exchanges with PKCE for a scoped key that authenticates, and revokes it on code reuse', async () => {
    const client = await registerClient({ client_name: 'Synthetic OAuth client', redirect_uris: [redirect] }, '127.0.0.1');
    made.clients.push(client.client_id);
    expect(await db.$queryRaw<unknown[]>`SELECT id FROM mcp_oauth_clients WHERE id = ${client.client_id}`).toHaveLength(1);

    // A wrong verifier burns the code.
    const burnt = pkce();
    const first = await createAuthorizationCode(actor, { clientId: client.client_id, redirectUri: redirect, codeChallenge: burnt.challenge, readFeatures: ['analytics/overview'], writeFeatures: [], resourceScope: { version: 1, mode: 'all' } });
    await expect(exchangeCode({ code: first.code, clientId: client.client_id, redirectUri: redirect, verifier: pkce().verifier }, '127.0.0.1')).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(exchangeCode({ code: first.code, clientId: client.client_id, redirectUri: redirect, verifier: burnt.verifier }, '127.0.0.1')).rejects.toMatchObject({ code: 'invalid_grant' });

    const good = pkce();
    const second = await createAuthorizationCode(actor, { clientId: client.client_id, redirectUri: redirect, codeChallenge: good.challenge, readFeatures: ['analytics/overview'], writeFeatures: [], resourceScope: { version: 1, mode: 'all' } });
    const stored = await db.$queryRaw<Array<{ codeHash: string }>>`SELECT "codeHash" FROM mcp_oauth_codes WHERE "clientId" = ${client.client_id} AND "usedAt" IS NULL`;
    expect(stored.map(r => r.codeHash)).toEqual([createHash('sha256').update(second.code).digest('hex')]);
    const token = await exchangeCode({ code: second.code, clientId: client.client_id, redirectUri: redirect, verifier: good.verifier }, '127.0.0.1');
    expect(token).toMatchObject({ token_type: 'Bearer', scope: 'read' });

    const viewer = await authenticateBearerHeader(`Bearer ${token.access_token}`);
    expect(viewer).toMatchObject({ scope: 'workspace', workspaceId: actor.workspaceId, userId: actor.userId });
    expect(viewer!.permissions.features['analytics/overview']?.write).toBe(false);
    expect(viewer!.permissions.features['settings/team']?.read).toBe(false);

    // Presenting the used code again is refused and revokes the key it produced.
    await expect(exchangeCode({ code: second.code, clientId: client.client_id, redirectUri: redirect, verifier: good.verifier }, '127.0.0.1')).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(await authenticateBearerHeader(`Bearer ${token.access_token}`)).toBeNull();
    const audits = await db.$queryRaw<Array<{ action: string }>>`SELECT action FROM activity_logs WHERE "workspaceId" = ${actor.workspaceId} AND action LIKE 'oauth.%' AND "createdAt" >= ${made.since} ORDER BY "createdAt"`;
    expect(audits.map(a => a.action)).toEqual(expect.arrayContaining(['oauth.consent_granted', 'oauth.token_issued', 'oauth.code_reuse_revoked']));
  });
});
