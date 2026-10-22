import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { hit } from '@/server/rate-limit';
import { clientIp } from '@/server/client-ip';
import { loadEntitlements } from '@/server/entitlements';
import { loadPermissions } from '@/server/permissions/loader';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { API_TOKEN_SHAPE, TOKEN_CREATE_SCHEMA, TOKEN_REVOKE_SCHEMA, confirmations, newApiToken, sha256, tokenPrefix, type IntegrationsActor } from '../contracts';
import { audit, authorize, exact, notFound, parse, protect, reachableTargets, requireEnabled, runtime, tokenColumnsReady, transact, type Authority, type Runtime, type Tx } from './core';
import { disableKeyWebhooks } from './webhooks';

export type TokenView = { id: string; name: string; prefix: string; scope: 'read' | 'write'; targetNames: string[] | null; createdBy: string; createdAt: Date; expiresAt: Date | null; lastUsedAt: Date | null; revokedAt: Date | null; status: 'active' | 'expired' | 'revoked' };

export async function listApiTokens(actor: IntegrationsActor, now = new Date()) {
  const auth = await authorize(actor, 'developer', false);
  const rt = await runtime();
  return protect((async () => {
    const ready = await tokenColumnsReady();
    const rows = ready
      ? await prisma.$queryRaw<Array<{ id: string; name: string; prefix: string; scope: string; targetIds: string[] | null; userName: string | null; createdAt: Date; expiresAt: Date | null; lastUsedAt: Date | null; revokedAt: Date | null }>>`SELECT t.id, t.name, t.prefix, t.scope, t."targetIds", u.name AS "userName", t."createdAt", t."expiresAt", t."lastUsedAt", t."revokedAt" FROM api_tokens t JOIN users u ON u.id = t."userId" WHERE t."workspaceId" = ${actor.workspaceId} ORDER BY t."createdAt" DESC, t.id DESC`
      : [];
    const channels = await reachableTargets(auth);
    const names = new Map(channels.map(channel => [channel.id, channel.name]));
    const tokens: TokenView[] = rows.map(row => ({
      id: row.id, name: row.name, prefix: row.prefix, scope: row.scope === 'write' ? 'write' : 'read', createdBy: row.userName ?? 'Former member',
      targetNames: row.targetIds ? row.targetIds.map(id => names.get(id) ?? 'Channel').sort() : null, createdAt: row.createdAt, expiresAt: row.expiresAt, lastUsedAt: row.lastUsedAt, revokedAt: row.revokedAt,
      status: row.revokedAt ? 'revoked' : !row.expiresAt || row.expiresAt <= now ? 'expired' : 'active',
    }));
    return { available: rt.enabled.api && ready, tokens, channels, defaultExpiryDays: rt.limits.apiDefaultExpiryDays, maxExpiryDays: rt.limits.apiMaxExpiryDays, maxTokens: rt.limits.apiMaxTokens };
  })());
}

/** Shared by the dashboard, MCP and the connector code exchange. Runs inside a developer transaction. */
export async function mintToken(tx: Tx, auth: Pick<Authority, 'permissions'>, actor: IntegrationsActor, rt: Runtime, input: { name: string; scope: 'read' | 'write'; targetIds?: string[]; expiresInDays?: number; origin: 'dashboard' | 'connector' }, now = new Date()) {
  if (!(await tokenColumnsReady(tx))) throw new OperationError('unavailable', 'API keys are not available until the installation is updated.');
  const days = input.expiresInDays ?? rt.limits.apiDefaultExpiryDays;
  if (days > rt.limits.apiMaxExpiryDays) throw new OperationError('invalid_request', `Keys may last at most ${rt.limits.apiMaxExpiryDays} days.`);
  const count = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM api_tokens WHERE "workspaceId" = ${actor.workspaceId} AND "revokedAt" IS NULL AND "expiresAt" > ${now}`;
  if (Number(count[0]?.count ?? 0) >= rt.limits.apiMaxTokens) throw new OperationError('conflict', 'This workspace has reached its API key limit. Revoke a key first.');
  let targetIds: string[] | null = null;
  if (input.targetIds) {
    targetIds = [...new Set(input.targetIds)];
    const reachable = new Set((await reachableTargets({ ...auth, actor, role: 'admin' }, tx)).map(channel => channel.id));
    if (!targetIds.length || targetIds.some(id => !reachable.has(id))) throw new OperationError('invalid_request', 'Choose channels you can access.');
  }
  const token = newApiToken(); const id = `tok_${randomUUID()}`; const expiresAt = new Date(now.getTime() + days * 86_400_000);
  await tx.$executeRaw`INSERT INTO api_tokens (id, "workspaceId", "userId", name, "tokenHash", prefix, scope, "targetIds", "expiresAt", "createdAt") VALUES (${id}, ${actor.workspaceId}, ${actor.userId}, ${input.name}, ${sha256(token)}, ${tokenPrefix(token)}, ${input.scope}, ${targetIds}::text[], ${expiresAt}, ${now})`;
  await audit(tx, actor, 'api_key.created', { tokenId: id, scope: input.scope, channels: targetIds?.length ?? null, expiresAt: expiresAt.toISOString(), origin: input.origin });
  return { id, token, prefix: tokenPrefix(token), scope: input.scope, expiresAt, targetIds };
}

/** The key is returned here once; only its sha256 is stored. */
export async function createApiToken(actor: IntegrationsActor, input: unknown, now = new Date()) {
  const data = parse(TOKEN_CREATE_SCHEMA, input, 'Enter a name, an access level and an optional channel list.'); exact(data.confirmation, confirmations.createToken(data.name));
  const rt = await runtime(); requireEnabled(rt, 'api');
  const auth = await authorize(actor, 'developer', true);
  if (data.scope === 'write' && !auth.permissions.pageScope.all && !data.targetIds) throw new OperationError('invalid_request', 'Choose the channels this write key may use.');
  const made = await protect(transact(actor, 'developer', rt.limits, async tx => {
    const fresh = await authorize(actor, 'developer', true);
    return mintToken(tx, fresh, actor, rt, { name: data.name, scope: data.scope, ...(data.targetIds ? { targetIds: data.targetIds } : {}), ...(data.expiresInDays ? { expiresInDays: data.expiresInDays } : {}), origin: 'dashboard' }, now);
  }, 'api-keys'));
  return { id: made.id, name: data.name, token: made.token, prefix: made.prefix, scope: made.scope, expiresAt: made.expiresAt, tokenNotice: 'Copy the key now; it is shown only once and cannot be recovered.' };
}

/** Revokes a key of this workspace and turns off the webhooks it subscribed. Idempotent for an already revoked key. */
export async function revokeApiToken(actor: IntegrationsActor, input: unknown, now = new Date()) {
  const data = parse(TOKEN_REVOKE_SCHEMA, input); exact(data.confirmation, confirmations.revokeToken(data.id));
  const rt = await runtime(); await authorize(actor, 'developer', true);
  return protect(transact(actor, 'developer', rt.limits, async tx => {
    await authorize(actor, 'developer', true);
    const rows = await tx.$queryRaw<Array<{ id: string; revokedAt: Date | null }>>`SELECT id, "revokedAt" FROM api_tokens WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    if (!rows[0]) throw notFound('API key');
    if (rows[0].revokedAt) return { id: data.id, revoked: true as const, alreadyRevoked: true as const, webhooksDisabled: 0 };
    await tx.$executeRaw`UPDATE api_tokens SET "revokedAt" = ${now} WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId}`;
    const webhooksDisabled = await disableKeyWebhooks(tx, actor.workspaceId, data.id);
    await audit(tx, actor, 'api_key.revoked', { tokenId: data.id, webhooksDisabled });
    return { id: data.id, revoked: true as const, alreadyRevoked: false as const, webhooksDisabled };
  }, 'api-keys'));
}

export class RateLimited extends OperationError {
  constructor(readonly retryAfterSeconds: number) { super('unavailable', 'Too many requests. Try again shortly.'); this.name = 'RateLimited'; }
}
export type ApiKeyContext = { tokenId: string; scope: 'read' | 'write'; actor: IntegrationsActor & { allowedTargetIds?: readonly string[] }; role: string; workspaceName: string };

const invalid = () => new OperationError('unauthorized', 'Send a valid API key as "Authorization: Bearer msp_...".');
/**
 * Resolve a bearer key to the person and workspace it acts as, with their role and channel access as they stand now:
 * demote someone and their keys are demoted with them; disable or remove them and the keys stop working. A key can only
 * narrow its owner's channel access, never widen it. Invalid, revoked and expired keys are indistinguishable to callers.
 */
export async function authenticateApiKey(request: Request, need: 'read' | 'write' = 'read', now = new Date()): Promise<ApiKeyContext> {
  const rt = await runtime(); requireEnabled(rt, 'api');
  const match = /^Bearer\s+(\S+)$/.exec((request.headers.get('authorization') ?? '').trim());
  const ip = clientIp(request) ?? 'unknown';
  if (!match || !API_TOKEN_SHAPE.test(match[1]!)) {
    // Malformed credentials count against the caller's address so guessing is throttled before any lookup.
    const bad = hit(`v1:bad:${ip}`, { limit: rt.limits.apiV1RatePerMinute, windowMs: 60_000, now: now.getTime() });
    if (!bad.allowed) throw new RateLimited(Math.max(1, Math.ceil((bad.resetAt - now.getTime()) / 1000)));
    throw invalid();
  }
  const ready = await tokenColumnsReady();
  const rows = ready
    ? await prisma.$queryRaw<Array<{ id: string; workspaceId: string; userId: string; scope: string; targetIds: string[] | null; expiresAt: Date | null; revokedAt: Date | null; lastUsedAt: Date | null; disabledAt: Date | null; suspendedAt: Date | null; workspaceName: string; role: string | null }>>`SELECT t.id, t."workspaceId", t."userId", t.scope, t."targetIds", t."expiresAt", t."revokedAt", t."lastUsedAt", u."disabledAt", w."suspendedAt", w.name AS "workspaceName", m.role::text AS role FROM api_tokens t JOIN users u ON u.id = t."userId" JOIN workspaces w ON w.id = t."workspaceId" LEFT JOIN memberships m ON m."userId" = t."userId" AND m."workspaceId" = t."workspaceId" WHERE t."tokenHash" = ${sha256(match[1]!)}`
    : [];
  const row = rows[0];
  if (!row) {
    const bad = hit(`v1:bad:${ip}`, { limit: rt.limits.apiV1RatePerMinute, windowMs: 60_000, now: now.getTime() });
    if (!bad.allowed) throw new RateLimited(Math.max(1, Math.ceil((bad.resetAt - now.getTime()) / 1000)));
    throw invalid();
  }
  const rate = hit(`v1:key:${row.id}`, { limit: rt.limits.apiV1RatePerMinute, windowMs: 60_000, now: now.getTime() });
  if (!rate.allowed) throw new RateLimited(Math.max(1, Math.ceil((rate.resetAt - now.getTime()) / 1000)));
  const expired = row.expiresAt ? row.expiresAt <= now : !rt.legacyKeysWithoutExpiry;
  if (row.revokedAt || expired || row.disabledAt || row.suspendedAt || !row.role) throw invalid();
  const [entitlements, permissions] = await Promise.all([loadEntitlements(row.userId, row.workspaceId, { allowInstallationInspection: false }), loadPermissions(row.userId, row.workspaceId)]);
  if (!entitlements || entitlements.workspaceId !== row.workspaceId || !permissions) throw invalid();
  await assertWorkspaceNotPurging(row.workspaceId);
  const scope: 'read' | 'write' = row.scope === 'write' ? 'write' : 'read';
  if (need === 'write' && scope !== 'write') throw new OperationError('forbidden', 'This API key can only read.');
  const owner = permissions.pageScope.all ? undefined : [...permissions.pageScope.ids];
  const allowedTargetIds = row.targetIds === null ? owner : owner === undefined ? row.targetIds : row.targetIds.filter(id => owner.includes(id));
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= rt.limits.apiLastUsedIntervalSeconds * 1000) {
    await prisma.$executeRaw`UPDATE api_tokens SET "lastUsedAt" = ${now} WHERE id = ${row.id}`.catch(() => undefined);
  }
  return { tokenId: row.id, scope, role: row.role, workspaceName: row.workspaceName, actor: { userId: row.userId, workspaceId: row.workspaceId, ...(allowedTargetIds === undefined ? {} : { allowedTargetIds }) } };
}
