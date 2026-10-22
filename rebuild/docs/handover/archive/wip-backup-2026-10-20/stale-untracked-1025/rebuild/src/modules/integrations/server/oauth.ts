import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { hit } from '@/server/rate-limit';
import { OAUTH_AUTHORIZE_SCHEMA, OAUTH_REGISTER_SCHEMA, OAUTH_TOKEN_SCHEMA, confirmations, isAllowedRedirect, s256, sha256, type IntegrationsActor } from '../contracts';
import { audit, authorize, exact, parse, protect, requireEnabled, runtime, tokenColumnsReady, transact } from './core';
import { mintToken } from './tokens';

/**
 * OAuth for remote connectors (for example MCP clients). Dynamic client registration, authorization-code grant with PKCE S256 only,
 * exact redirect-address matching, one-time hashed codes, no refresh tokens: the access token is an ordinary, expiring, revocable API key.
 */
export type RegisteredClient = { client_id: string; client_name: string; redirect_uris: string[]; token_endpoint_auth_method: 'none'; grant_types: ['authorization_code']; response_types: ['code']; code_challenge_methods_supported: ['S256'] };

export async function registerClient(input: unknown, callerKey: string, now = new Date()): Promise<RegisteredClient> {
  const rt = await runtime(); requireEnabled(rt, 'oauth');
  const parsed = OAUTH_REGISTER_SCHEMA.safeParse(input);
  const limited = hit(`oauth:register:${callerKey}`, { limit: rt.limits.oauthRegistrationsPerHour, windowMs: 3_600_000, now: now.getTime() });
  if (!limited.allowed) throw new OperationError('unavailable', 'Too many registrations. Try again later.');
  if (!parsed.success) throw new OperationError('invalid_request', 'Provide a name and at least one redirect address.');
  const uris = [...new Set(parsed.data.redirect_uris)];
  if (uris.length > rt.limits.oauthMaxRedirectUris || !uris.every(isAllowedRedirect)) throw new OperationError('invalid_request', 'Redirect addresses must use https (or http on this machine), carry no fragment or credentials, and stay within the allowed number.');
  const id = `oc_${randomUUID()}`;
  await protect(prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('integrations:oauth-clients', 0))::text`;
    const count = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "OAuthClient"`;
    if (Number(count[0]?.count ?? 0) >= rt.limits.oauthMaxClients) throw new OperationError('unavailable', 'Connector registration is closed right now.');
    await tx.$executeRaw`INSERT INTO "OAuthClient" (id, name, "redirectUris", "createdAt") VALUES (${id}, ${parsed.data.client_name}, ${uris}::text[], ${now})`;
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, NULL, 'oauth.client_registered', ${JSON.stringify({ clientId: id, redirects: uris.length })}::jsonb, ${now})`;
  }, { timeout: rt.limits.transactionTimeoutMs, maxWait: rt.limits.transactionMaxWaitMs }));
  return { client_id: id, client_name: parsed.data.client_name, redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'], code_challenge_methods_supported: ['S256'] };
}

/** What the consent page shows. The redirect address must equal a registered one exactly; nothing is ever derived or normalised. */
export async function describeClientForConsent(clientId: string, redirectUri: string) {
  const rt = await runtime(); requireEnabled(rt, 'oauth');
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; redirectUris: string[] }>>`SELECT id, name, "redirectUris" FROM "OAuthClient" WHERE id = ${String(clientId).slice(0, 80)}`;
  const client = rows[0];
  if (!client || !client.redirectUris.includes(redirectUri)) throw new OperationError('invalid_request', 'This connection request is not valid. Return to the app and start again.');
  return { clientId: client.id, name: client.name, redirectHost: new URL(redirectUri).host };
}

/** Records the person's consent and returns the exact redirect to send them to. Only owners/admins who may make keys can consent. */
export async function authorizeConnector(actor: IntegrationsActor, input: unknown, now = new Date()) {
  const data = parse(OAUTH_AUTHORIZE_SCHEMA, input, 'This connection request is not valid. Return to the app and start again.');
  exact(data.confirmation, confirmations.authorizeConnector(data.clientId));
  const rt = await runtime(); requireEnabled(rt, 'oauth'); requireEnabled(rt, 'api');
  await authorize(actor, 'developer', true);
  if (!(await tokenColumnsReady())) throw new OperationError('unavailable', 'Connectors are not available until the installation is updated.');
  const client = await describeClientForConsent(data.clientId, data.redirectUri);
  const code = randomBytes(32).toString('base64url');
  await protect(transact(actor, 'developer', rt.limits, async tx => {
    await authorize(actor, 'developer', true);
    await tx.$executeRaw`INSERT INTO "OAuthCode" (id, "codeHash", "clientId", "userId", "workspaceId", "redirectUri", "codeChallenge", scope, "expiresAt", "createdAt") VALUES (${randomUUID()}, ${sha256(code)}, ${client.clientId}, ${actor.userId}, ${actor.workspaceId}, ${data.redirectUri}, ${data.codeChallenge}, ${data.scope}, ${new Date(now.getTime() + rt.limits.oauthCodeTtlSeconds * 1000)}, ${now})`;
    await audit(tx, actor, 'oauth.consent_granted', { clientId: client.clientId, scope: data.scope });
  }, 'api-keys'));
  const target = new URL(data.redirectUri); target.searchParams.set('code', code); if (data.state) target.searchParams.set('state', data.state);
  return { redirectTo: target.toString(), connector: client.name };
}

const grantFailure = () => new OperationError('invalid_request', 'The code is unknown, used or expired, or does not match this request.');
const same = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** A code works once. It is deleted before verification, so a failed attempt and a racing duplicate both burn it. */
export async function exchangeCode(input: unknown, now = new Date()) {
  const data = parse(OAUTH_TOKEN_SCHEMA, input, 'The token request is not valid.');
  const rt = await runtime(); requireEnabled(rt, 'oauth'); requireEnabled(rt, 'api');
  const rows = await protect(prisma.$queryRaw<Array<{ clientId: string; userId: string; workspaceId: string; redirectUri: string; codeChallenge: string; scope: string; expiresAt: Date; name: string | null }>>`DELETE FROM "OAuthCode" c WHERE c."codeHash" = ${sha256(data.code)} RETURNING c."clientId", c."userId", c."workspaceId", c."redirectUri", c."codeChallenge", c.scope, c."expiresAt", (SELECT name FROM "OAuthClient" WHERE id = c."clientId") AS name`);
  const row = rows[0];
  if (!row || row.expiresAt.getTime() <= now.getTime() || row.clientId !== data.client_id || row.redirectUri !== data.redirect_uri || !row.name || !same(s256(data.code_verifier), row.codeChallenge)) throw grantFailure();
  const actor = { userId: row.userId, workspaceId: row.workspaceId };
  // Authority is re-read now: a person demoted, disabled or removed since consent cannot obtain a key.
  let auth; try { auth = await authorize(actor, 'developer', true); } catch { throw grantFailure(); }
  const scope = row.scope === 'write' ? 'write' : 'read';
  const made = await protect(transact(actor, 'developer', rt.limits, async tx => mintToken(tx, auth, actor, rt, { name: `${row.name} (connector)`.slice(0, 60), scope, origin: 'connector' }, now), 'api-keys'));
  return { access_token: made.token, token_type: 'Bearer' as const, scope, expires_in: Math.max(1, Math.floor((made.expiresAt.getTime() - now.getTime()) / 1000)) };
}

/** For the housekeeping worker: unused expired codes. */
export async function purgeExpiredCodes(now = new Date()) {
  return Number(await prisma.$executeRaw`DELETE FROM "OAuthCode" WHERE "expiresAt" < ${new Date(now.getTime() - 3_600_000)}`);
}
