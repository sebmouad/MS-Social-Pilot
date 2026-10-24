import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { PAGES } from '@/lib/product';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { hit } from '@/server/rate-limit';
import { issueMcpKey } from '@/modules/settings/mcp-access/server';
import { INTEGRATIONS_CONFIG, INTEGRATIONS_INPUT_HARD_MAX } from '../config';
import { cleanClientName, OAuthError, pkceMatches, redirectRegistered, registrationSchemaForLimits, safeEqual, sha256Hex, CLIENT_ID, CODE_CHALLENGE } from './protocol';

/**
 * OAuth for MCP clients. The access token is an ordinary scoped `mcp_api_keys` row made by the Settings issuance
 * service at token exchange, so the bearer path, its ceilings and revocation apply unchanged. No refresh tokens:
 * the legacy flow had none; the client asks again when the key ends. Codes are stored only as hashes, work once and
 * are bound to client, redirect and PKCE challenge.
 */

type Actor = { userId: string; workspaceId: string };
export type OAuthClientRow = { id: string; name: string; redirectUris: string[] };
export type OAuthResourceScope = { version: 1; mode: 'all' } | { version: 1; mode: 'selected'; ids: string[]; adAccountIds: string[] };

export type OAuthRuntime = {
  enabled: boolean; issuer: string | null; codeTtlSeconds: number; keyLifetimeDays: number; maxClients: number; clientIdleDays: number;
  registrationsPerHour: number; tokenAttemptsPerMinute: number; consentsPerHour: number;
  clientNameInputMaxCharacters: number; clientNameMaxCharacters: number; redirectUriMaxCharacters: number; redirectUrisMaxItems: number; authorizationStateMaxCharacters: number;
  scopeMaxCharacters: number; resourceIdMaxCharacters: number; resourceIdsMaxItems: number; issuedKeyNameMaxCharacters: number;
  defaultClientName: string; issuedKeyNamePrefix: string;
};
const KEYS = {
  enabled: 'integrations.oauth.enabled', issuer: 'integrations.oauth.issuerUrl', codeTtlSeconds: 'integrations.oauth.codeTtlSeconds', keyLifetimeDays: 'integrations.oauth.keyLifetimeDays',
  maxClients: 'integrations.oauth.maxClients', clientIdleDays: 'integrations.oauth.clientIdleDays', registrationsPerHour: 'integrations.oauth.registrationsPerHour',
  tokenAttemptsPerMinute: 'integrations.oauth.tokenAttemptsPerMinute', consentsPerHour: 'integrations.oauth.consentsPerHour',
  clientNameInputMaxCharacters: 'integrations.oauth.clientNameInputMaxCharacters', clientNameMaxCharacters: 'integrations.oauth.clientNameMaxCharacters', redirectUriMaxCharacters: 'integrations.oauth.redirectUriMaxCharacters',
  redirectUrisMaxItems: 'integrations.oauth.redirectUrisMaxItems', authorizationStateMaxCharacters: 'integrations.oauth.authorizationStateMaxCharacters',
  scopeMaxCharacters: 'integrations.oauth.scopeMaxCharacters', resourceIdMaxCharacters: 'integrations.oauth.resourceIdMaxCharacters',
  resourceIdsMaxItems: 'integrations.oauth.resourceIdsMaxItems', issuedKeyNameMaxCharacters: 'integrations.oauth.issuedKeyNameMaxCharacters',
  defaultClientName: 'integrations.oauth.defaultClientName', issuedKeyNamePrefix: 'integrations.oauth.issuedKeyNamePrefix',
} as const;
const unavailable = () => new OAuthError('temporarily_unavailable', 'OAuth connectors are not available right now.', 503);

/** Live Root values, each re-validated against its registry schema. Anything invalid makes the feature unavailable. */
export async function oauthRuntime(): Promise<OAuthRuntime> {
  try {
    const out: Record<string, unknown> = {};
    for (const [field, key] of Object.entries(KEYS)) {
      const definition = INTEGRATIONS_CONFIG.find(item => item.key === key);
      const parsed = definition?.schema.safeParse(await runtimeConfig(key));
      if (!parsed?.success) throw unavailable();
      out[field] = parsed.data;
    }
    const issuer = out.issuer as string;
    return { ...(out as Omit<OAuthRuntime, 'issuer'>), issuer: issuer || null };
  } catch { throw unavailable(); }
}
/** Enabled and configured; otherwise every OAuth endpoint refuses. */
export async function requireOAuth(): Promise<OAuthRuntime & { issuer: string }> {
  const rt = await oauthRuntime();
  if (!rt.enabled || !rt.issuer) throw unavailable();
  return rt as OAuthRuntime & { issuer: string };
}

async function rootAudit(action: string, detail: Record<string, unknown>) {
  const n = await prisma.$executeRaw`INSERT INTO root_activities (id,"actorId",action,detail,"createdAt") VALUES (${`oauth_${randomUUID()}`},NULL,${action},${JSON.stringify(detail)}::jsonb,NOW())`;
  if (n !== 1) throw new OAuthError('server_error', 'The change could not be recorded.', 500);
}
async function workspaceAudit(actor: Actor, action: string, detail: Record<string, unknown>) {
  const n = await prisma.$executeRaw`INSERT INTO activity_logs (id,"workspaceId","actorId",action,detail,"createdAt") VALUES (${randomUUID()},${actor.workspaceId},${actor.userId},${action},${JSON.stringify(detail)}::jsonb,NOW())`;
  if (n !== 1) throw new OAuthError('server_error', 'The change could not be recorded.', 500);
}

/** Dynamic client registration (RFC 7591): public clients only, exact redirect URIs, bounded and rate limited. */
export async function registerClient(input: unknown, ip: string | null) {
  const rt = await requireOAuth();
  const limit = hit(`oauth:register:${ip ?? 'all'}`, { limit: rt.registrationsPerHour, windowMs: 3_600_000 });
  if (!limit.allowed) throw new OAuthError('temporarily_unavailable', 'Too many registrations. Try again later.', 429);
  const parsed = registrationSchemaForLimits(rt).safeParse(input);
  if (!parsed.success) throw new OAuthError('invalid_client_metadata', parsed.error.issues.map(issue => issue.message).join('; ') || 'Send JSON with redirect_uris.');
  const uris = [...new Set(parsed.data.redirect_uris)];
  const name = cleanClientName(parsed.data.client_name, rt.clientNameMaxCharacters, rt.defaultClientName);
  await prisma.$executeRaw`DELETE FROM mcp_oauth_clients WHERE COALESCE("lastUsedAt","createdAt") < NOW() - (${rt.clientIdleDays} * INTERVAL '1 day')`;
  const count = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM mcp_oauth_clients`;
  if (Number(count[0]?.count ?? 0) >= rt.maxClients) throw new OAuthError('temporarily_unavailable', 'Client registration is full. Try again later.', 503);
  const id = `oc_${randomBytes(18).toString('base64url')}`;
  const inserted = await prisma.$executeRaw`INSERT INTO mcp_oauth_clients (id,name,"redirectUris","createdAt") VALUES (${id},${name},${uris}::text[],NOW())`;
  if (inserted !== 1) throw new OAuthError('server_error', 'Registration could not be saved.', 500);
  await rootAudit('oauth.client_registered', { clientId: id, name, redirectUris: uris });
  return { client_id: id, client_name: name, redirect_uris: uris, grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none', client_id_issued_at: Math.floor(Date.now() / 1000) };
}

export async function findClient(id: string): Promise<OAuthClientRow | null> {
  if (!CLIENT_ID.test(id)) return null;
  const rows = await prisma.$queryRaw<OAuthClientRow[]>`SELECT id,name,"redirectUris" FROM mcp_oauth_clients WHERE id=${id} LIMIT 1`;
  return rows[0] ?? null;
}

const featureIds = PAGES.map(page => page.id) as [string, ...string[]];
const decisionSchema = z.object({
  clientId: z.string(), redirectUri: z.string(), codeChallenge: z.string().regex(CODE_CHALLENGE),
  readFeatures: z.array(z.enum(featureIds)).min(1).max(featureIds.length),
  writeFeatures: z.array(z.enum(featureIds)).max(featureIds.length),
  resourceScope: z.discriminatedUnion('mode', [
    z.object({ version: z.literal(1), mode: z.literal('all') }).strict(),
    z.object({ version: z.literal(1), mode: z.literal('selected'), ids: z.array(z.string().min(1).max(INTEGRATIONS_INPUT_HARD_MAX)).max(INTEGRATIONS_INPUT_HARD_MAX), adAccountIds: z.array(z.string().min(1).max(INTEGRATIONS_INPUT_HARD_MAX)).max(INTEGRATIONS_INPUT_HARD_MAX) }).strict(),
  ]),
}).strict();
export type ConsentDecision = z.input<typeof decisionSchema>;

/**
 * The consent screen's "allow": validated again here (the form is a convenience, this decides). The caller has already
 * proved same-origin, a signed-in owner/admin with the Settings MCP write grant, and that the form's workspace is the viewer's.
 * Returns the one-time code. Feature and resource ceilings are enforced when the key is made at exchange, so a
 * permission lost in between refuses the exchange.
 */
export async function createAuthorizationCode(actor: Actor, raw: unknown): Promise<{ code: string; ttlSeconds: number }> {
  const rt = await requireOAuth();
  const limit = hit(`oauth:consent:${actor.userId}`, { limit: rt.consentsPerHour, windowMs: 3_600_000 });
  if (!limit.allowed) throw new OAuthError('temporarily_unavailable', 'Too many decisions. Try again later.', 429);
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success || parsed.data.writeFeatures.some(feature => !parsed.data.readFeatures.includes(feature))) throw new OAuthError('invalid_request', 'Choose valid access.');
  const data = parsed.data;
  if (data.redirectUri.length > rt.redirectUriMaxCharacters || data.resourceScope.mode === 'selected' && [data.resourceScope.ids, data.resourceScope.adAccountIds].some(ids => ids.length > rt.resourceIdsMaxItems || ids.some(id => id.length > rt.resourceIdMaxCharacters))) {
    throw new OAuthError('invalid_request', 'The selected redirect or resources exceed the current connector limits.');
  }
  const client = await findClient(data.clientId);
  if (!client || !redirectRegistered(client.redirectUris, data.redirectUri)) throw new OAuthError('invalid_request', 'Unknown client or redirect address.');
  const scope = data.resourceScope.mode === 'selected' ? { ...data.resourceScope, ids: [...new Set(data.resourceScope.ids)], adAccountIds: [...new Set(data.resourceScope.adAccountIds)] } : data.resourceScope;
  const code = randomBytes(32).toString('base64url');
  const id = `ocode_${randomBytes(12).toString('hex')}`;
  const inserted = await prisma.$executeRaw`INSERT INTO mcp_oauth_codes (id,"codeHash","clientId","userId","workspaceId","redirectUri","codeChallenge","readFeatures","writeFeatures","resourceScope","expiresAt","createdAt") VALUES (${id},${sha256Hex(code)},${client.id},${actor.userId},${actor.workspaceId},${data.redirectUri},${data.codeChallenge},${data.readFeatures}::text[],${data.writeFeatures}::text[],${JSON.stringify(scope)}::jsonb,NOW() + (${rt.codeTtlSeconds} * INTERVAL '1 second'),NOW())`;
  if (inserted !== 1) throw new OAuthError('server_error', 'The decision could not be saved.', 500);
  await workspaceAudit(actor, 'oauth.consent_granted', { clientId: client.id, clientName: client.name, redirectHost: new URL(data.redirectUri).host, readFeatures: data.readFeatures, writeFeatures: data.writeFeatures, resourceScope: scope });
  return { code, ttlSeconds: rt.codeTtlSeconds };
}

export async function recordDenied(actor: Actor, clientId: string) {
  const rt = await requireOAuth();
  if (!hit(`oauth:consent:${actor.userId}`, { limit: rt.consentsPerHour, windowMs: 3_600_000 }).allowed) throw new OAuthError('temporarily_unavailable', 'Too many decisions. Try again later.', 429);
  await workspaceAudit(actor, 'oauth.consent_denied', { clientId });
}

type CodeRow = { id: string; clientId: string; userId: string; workspaceId: string; redirectUri: string; codeChallenge: string; readFeatures: string[]; writeFeatures: string[]; resourceScope: unknown; expired: boolean; keyId: string | null };

async function revokeIssuedKey(row: { userId: string; workspaceId: string; keyId: string | null; clientId: string }) {
  if (!row.keyId) return;
  const changed = await prisma.$executeRaw`UPDATE mcp_api_keys SET "revokedAt"=NOW() WHERE id=${row.keyId} AND "workspaceId"=${row.workspaceId} AND "revokedAt" IS NULL`;
  await workspaceAudit({ userId: row.userId, workspaceId: row.workspaceId }, 'oauth.code_reuse_revoked', { clientId: row.clientId, keyId: row.keyId, revoked: changed === 1 });
}

/**
 * Swap a code for a scoped key. The code is consumed by one atomic UPDATE before anything else is checked, so racing
 * requests cannot both succeed and a wrong verifier burns the code. Presenting an already used code revokes the key
 * it produced (RFC 6749 4.1.2).
 */
export async function exchangeCode(input: { code: string; clientId: string; redirectUri: string; verifier: string }, ip: string | null) {
  const rt = await requireOAuth();
  if (!hit(`oauth:token:${input.clientId}:${ip ?? '-'}`, { limit: rt.tokenAttemptsPerMinute, windowMs: 60_000 }).allowed) throw new OAuthError('temporarily_unavailable', 'Too many requests. Slow down.', 429);
  const codeHash = sha256Hex(input.code);
  const consumed = await prisma.$queryRaw<CodeRow[]>`UPDATE mcp_oauth_codes SET "usedAt"=NOW() WHERE "codeHash"=${codeHash} AND "usedAt" IS NULL RETURNING id,"clientId","userId","workspaceId","redirectUri","codeChallenge","readFeatures","writeFeatures","resourceScope","expiresAt" < NOW() AS expired,"keyId"`;
  const row = consumed[0];
  const grantFailed = () => new OAuthError('invalid_grant', 'The code is unknown, used, expired or does not match.');
  if (!row) {
    const earlier = await prisma.$queryRaw<CodeRow[]>`SELECT id,"clientId","userId","workspaceId","redirectUri","codeChallenge","readFeatures","writeFeatures","resourceScope",false AS expired,"keyId" FROM mcp_oauth_codes WHERE "codeHash"=${codeHash} LIMIT 1`;
    if (earlier[0]) await revokeIssuedKey(earlier[0]);
    throw grantFailed();
  }
  if (row.expired || !safeEqual(row.clientId, input.clientId) || !safeEqual(row.redirectUri, input.redirectUri) || !pkceMatches(input.verifier, row.codeChallenge)) throw grantFailed();
  const client = await findClient(row.clientId);
  if (!client || !redirectRegistered(client.redirectUris, row.redirectUri)) throw grantFailed();
  const maxDays = await runtimeConfig('mcp.keys.maxLifetimeDays');
  const days = Math.min(rt.keyLifetimeDays, typeof maxDays === 'number' ? maxDays : 1);
  const name = `${rt.issuedKeyNamePrefix}${client.name}`.slice(0, rt.issuedKeyNameMaxCharacters);
  let issued: Awaited<ReturnType<typeof issueMcpKey>>;
  try {
    issued = await issueMcpKey({ userId: row.userId, workspaceId: row.workspaceId }, { name, readFeatures: row.readFeatures, writeFeatures: row.writeFeatures, expiresInDays: days, resourceScope: row.resourceScope, confirmation: `CREATE MCP KEY ${name}` });
  } catch (error) {
    // The person may have lost access since consenting; the key service says no and nothing is issued.
    if (error instanceof OperationError) throw new OAuthError('invalid_grant', 'This access can no longer be granted.');
    throw new OAuthError('server_error', 'The key could not be issued.', 500);
  }
  try {
    const linked = await prisma.$executeRaw`UPDATE mcp_oauth_codes SET "keyId"=${issued.key.id} WHERE id=${row.id}`;
    await prisma.$executeRaw`UPDATE mcp_oauth_clients SET "lastUsedAt"=NOW() WHERE id=${client.id}`;
    if (linked !== 1) throw new Error('unlinked');
    await workspaceAudit({ userId: row.userId, workspaceId: row.workspaceId }, 'oauth.token_issued', { clientId: client.id, clientName: client.name, keyId: issued.key.id, expiresAt: issued.key.expiresAt.toISOString() });
  } catch {
    // Never leave a key that reuse or audit cannot reach.
    await prisma.$executeRaw`UPDATE mcp_api_keys SET "revokedAt"=NOW() WHERE id=${issued.key.id} AND "revokedAt" IS NULL`;
    throw new OAuthError('server_error', 'The key could not be issued.', 500);
  }
  const scope = row.writeFeatures.length ? 'read write' : 'read';
  return { access_token: issued.token, token_type: 'Bearer', expires_in: Math.max(1, Math.floor((issued.key.expiresAt.getTime() - Date.now()) / 1000)), scope };
}
