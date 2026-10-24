import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { Prisma, type TargetType } from '../../../generated/client';
import { prisma } from '@/server/data';
import { encryptSecret, decryptSecret } from '@/server/secret-crypto';
import { runtimeConfig } from '@/server/config/store';
import { loadEntitlements, canUseFeature, hasPlatformCapability } from '@/server/entitlements';
import { loadPermissions } from '@/server/permissions/loader';
import { canAccessFeature } from '@/server/permissions';
import { isPlatformEnabled } from './registry';
import { assertWorkspaceNotPurging, withWorkspaceOperation } from '@/server/data-control/guard';
import { auditConnectionEvent, type ConnectionMutationActor } from '@/server/connection-mutations';
import { lockSelectedResources } from './resource-lock';
import { ProviderHttpError } from './provider-http';
import type { ConnectionViewer } from './host';

/**
 * Platform-neutral connection flow for providers that use a plain OAuth 2 authorization-code grant with
 * refresh tokens (optionally PKCE). Modules supply the provider protocol through a `TokenOAuthFlow`; this
 * file owns state binding, workspace guards, persistence of the credential and its destinations, and the
 * stored-token helpers the module's renewal uses. It names no provider.
 */
export const tokenCallbackPath = (provider: string) => `/api/connections/${provider}/callback`;
export const tokenOAuthCookie = (provider: string) => `msp_${provider}_oauth`;
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

type PendingState = { state: string; userId: string; workspaceId: string; expiresAt: number; verifier?: string };

export function createTokenOAuthState(input: { userId: string; workspaceId: string; ttlSeconds: number; pkce: boolean; now?: number }) {
  const pending: PendingState = {
    state: randomBytes(32).toString('base64url'), userId: input.userId, workspaceId: input.workspaceId,
    expiresAt: (input.now ?? Date.now()) + input.ttlSeconds * 1000, ...(input.pkce ? { verifier: randomBytes(48).toString('base64url') } : {}),
  };
  return { state: pending.state, verifier: pending.verifier ?? null, cookieValue: encryptSecret(JSON.stringify(pending)) };
}

/** Decrypt and bind callback state to the initiating session and workspace. */
export function openTokenOAuthState(cookieValue: string | undefined, state: string | null, userId: string, workspaceId: string, now = Date.now()): { verifier: string | null } | null {
  if (!cookieValue || !state || state.length > 256) return null;
  try {
    const pending = JSON.parse(decryptSecret(cookieValue)) as Partial<PendingState>;
    if (typeof pending.state !== 'string' || typeof pending.userId !== 'string' || typeof pending.workspaceId !== 'string' || typeof pending.expiresAt !== 'number') return null;
    const actual = Buffer.from(pending.state); const provided = Buffer.from(state);
    if (actual.length !== provided.length || !timingSafeEqual(actual, provided)) return null;
    if (pending.userId !== userId || pending.workspaceId !== workspaceId || pending.expiresAt <= now) return null;
    return { verifier: typeof pending.verifier === 'string' ? pending.verifier : null };
  } catch { return null; }
}

export interface TokenConnectionDestination { providerId: string; name: string; pictureUrl: string | null }
export interface TokenConnectionResult {
  providerUserId: string; name: string; pictureUrl: string | null;
  accessToken: string; refreshToken: string | null;
  /** When the access token stops working; the module renews it before then. */
  accessExpiresAt: Date | null;
  /** When the whole grant ends (a refresh token's life). Null means until the customer revokes it. */
  grantExpiresAt: Date | null;
  scopes: string[]; destinations: TokenConnectionDestination[];
}

export interface TokenOAuthFlow {
  provider: string;
  pkce: boolean;
  stateTtlSeconds(): Promise<number>;
  /** Module-owned Root bound; omitted by older installed flows. */
  codeMaxLength?(): Promise<number>;
  /** Null when Root has not filled in the credentials. */
  authorizationUrl(input: { redirectUri: string; state: string; challenge: string | null }): Promise<string | null>;
  /** Exchange the code and discover every destination the account can publish to. */
  complete(input: { code: string; redirectUri: string; verifier: string | null; signal?: AbortSignal }): Promise<TokenConnectionResult>;
}

async function publicOrigin(): Promise<string> {
  const origin = await runtimeConfig('app.publicOrigin');
  const parsed = new URL(origin);
  if (parsed.origin !== origin || parsed.username || parsed.password || !['https:', 'http:'].includes(parsed.protocol)) throw new Error('Public origin is not configured.');
  return origin;
}

/** Recheck current service authority before exchanging provider codes, independently of the route. */
export async function authorizeTokenOAuth(viewer: ConnectionViewer, provider: string): Promise<void> {
  const [membership, permissions, access] = await Promise.all([
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: viewer.user.id, workspaceId: viewer.workspaceId } }, select: { role: true } }),
    loadPermissions(viewer.user.id, viewer.workspaceId),
    loadEntitlements(viewer.user.id, viewer.workspaceId, { allowInstallationInspection: false }),
  ]);
  if (!membership || !['owner', 'admin'].includes(membership.role) || !permissions || !canAccessFeature(permissions, 'settings/connections', 'write') || !access || access.workspaceId !== viewer.workspaceId || !canUseFeature(access, 'settings/connections') || !hasPlatformCapability(access, provider) || !await isPlatformEnabled(provider)) throw new Error('Connection is unavailable.');
}

const unavailable = () => NextResponse.json({ error: 'Connection unavailable. Try again or contact support.' }, { status: 503 });

export async function startTokenOAuth(flow: TokenOAuthFlow, request: Request, viewer: ConnectionViewer): Promise<NextResponse> {
  try {
    await authorizeTokenOAuth(viewer, flow.provider);
    await assertWorkspaceNotPurging(viewer.workspaceId);
    const ttlSeconds = await flow.stateTtlSeconds();
    const pending = createTokenOAuthState({ userId: viewer.user.id, workspaceId: viewer.workspaceId, ttlSeconds, pkce: flow.pkce });
    if (pending.cookieValue.length > 3000) return unavailable();
    const redirectUri = new URL(tokenCallbackPath(flow.provider), await publicOrigin()).toString();
    const authorizationUrl = await flow.authorizationUrl({ redirectUri, state: pending.state, challenge: pending.verifier ? pkceChallenge(pending.verifier) : null });
    if (!authorizationUrl) return unavailable();
    const response = NextResponse.json({ authorizationUrl }, { headers: { 'cache-control': 'no-store' } });
    response.cookies.set(tokenOAuthCookie(flow.provider), pending.cookieValue, {
      httpOnly: true, secure: new URL(await publicOrigin()).protocol === 'https:', sameSite: 'lax', path: tokenCallbackPath(flow.provider), maxAge: ttlSeconds,
    });
    return response;
  } catch { return unavailable(); }
}

export async function finishTokenOAuth(flow: TokenOAuthFlow, request: NextRequest, viewer: ConnectionViewer): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const pending = openTokenOAuthState(request.cookies.get(tokenOAuthCookie(flow.provider))?.value, params.get('state'), viewer.user.id, viewer.workspaceId);
  if (!pending) return finish(flow, request, 'oauth_invalid_state');
  if (params.has('error')) return finish(flow, request, 'oauth_cancelled');
  const code = params.get('code');
  if (!code || code.length > (flow.codeMaxLength ? await flow.codeMaxLength() : 4096)) return finish(flow, request, 'connect_failed');
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  let stage = 'exchange';
  try {
    return await withWorkspaceOperation(viewer.workspaceId, async () => {
      await authorizeTokenOAuth(viewer, flow.provider);
      const redirectUri = new URL(tokenCallbackPath(flow.provider), await publicOrigin()).toString();
      const result = await flow.complete({ code, redirectUri, verifier: pending.verifier });
      stage = 'persist';
      const saved = await persistTokenConnection(actor, flow.provider, result);
      return finish(flow, request, saved.skipped ? 'connected_partial' : 'connected', true);
    });
  } catch (error) {
    // Only a stage and class are kept; provider messages and credentials stay server-side.
    console.warn(`[${flow.provider}-connect] callback failed`, { stage, name: error instanceof Error ? error.name : 'unknown' });
    try { await prisma.$transaction(tx => auditConnectionEvent(tx, actor, `connection.${flow.provider}_failed`, { stage })); } catch { /* audit is best effort */ }
    return finish(flow, request, 'connect_failed');
  }
}

async function finish(flow: TokenOAuthFlow, request: NextRequest, notice: string, openSelection = false) {
  const location = new URL(`/settings/channels?notice=${encodeURIComponent(notice)}${openSelection ? '&select=1' : ''}`, await publicOrigin());
  const response = NextResponse.redirect(location, { status: 303, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  response.cookies.set(tokenOAuthCookie(flow.provider), '', {
    httpOnly: true, secure: new URL(await publicOrigin()).protocol === 'https:', sameSite: 'lax', path: tokenCallbackPath(flow.provider), maxAge: 0,
  });
  return response;
}

/** Persist the credential and discovered destinations without activating new workspace destinations. */
export async function persistTokenConnection(actor: ConnectionMutationActor, provider: string, input: TokenConnectionResult) {
  const now = new Date();
  const type = provider as TargetType;
  return prisma.$transaction(async tx => {
    const membership = await tx.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } });
    if (!membership || !['owner', 'admin'].includes(membership.role)) throw new Error('Only current workspace owners and admins can connect accounts.');
    const previous = await tx.socialAccount.findUnique({ where: { workspaceId_provider_providerUserId: { workspaceId: actor.workspaceId, provider, providerUserId: input.providerUserId } }, select: { id: true } });
    const existing = await tx.target.findMany({ where: { workspaceId: actor.workspaceId, OR: [
      { type, providerId: { in: input.destinations.map(item => item.providerId) } }, ...(previous ? [{ socialAccountId: previous.id }] : []),
    ] }, select: { id: true } });
    await lockSelectedResources(tx, actor.workspaceId, existing.map(target => ({ kind: 'target' as const, id: target.id })));
    const credentials = {
      name: input.name, pictureUrl: input.pictureUrl, accessToken: encryptSecret(input.accessToken),
      refreshToken: input.refreshToken ? encryptSecret(input.refreshToken) : null, tokenExpiresAt: input.grantExpiresAt,
      scopes: input.scopes.join(','), invalidatedAt: null, invalidReason: null, updatedAt: now,
    };
    const account = await tx.socialAccount.upsert({
      where: { workspaceId_provider_providerUserId: { workspaceId: actor.workspaceId, provider, providerUserId: input.providerUserId } },
      create: { id: randomUUID(), workspaceId: actor.workspaceId, provider, providerUserId: input.providerUserId, createdAt: now, ...credentials },
      update: credentials, select: { id: true },
    });
    await writeAccessExpiry(tx, actor.workspaceId, account.id, input.accessExpiresAt);
    let saved = 0; let skipped = 0;
    for (const destination of input.destinations) {
      const current = await tx.target.findUnique({ where: { workspaceId_providerId: { workspaceId: actor.workspaceId, providerId: destination.providerId } }, select: { id: true, socialAccountId: true, type: true } });
      const data = { socialAccountId: account.id, type, name: destination.name, pictureUrl: destination.pictureUrl, accessToken: encryptSecret(input.accessToken), canPublish: true };
      if (!current) { await tx.target.create({ data: { id: randomUUID(), workspaceId: actor.workspaceId, providerId: destination.providerId, ...data, enabled: false, createdAt: now } }); saved++; }
      else if (current.type === type && (current.socialAccountId === null || current.socialAccountId === account.id)) {
        await tx.target.update({ where: { id: current.id }, data: { ...data, ...(current.socialAccountId === null ? { enabled: false } : {}) } }); saved++;
      } else skipped++; // Never take another connection's destination or inherit its selection.
    }
    await tx.target.updateMany({ where: { workspaceId: actor.workspaceId, socialAccountId: account.id, type, providerId: { notIn: input.destinations.map(item => item.providerId) } }, data: { enabled: false, canPublish: false } });
    await auditConnectionEvent(tx, actor, `connection.${provider}_connected`, { providerUserId: input.providerUserId, destinations: saved, skipped });
    return { saved, skipped };
  });
}

export interface StoredToken {
  socialAccountId: string; accessToken: string; storedAccessToken: string; refreshToken: string | null;
  accessExpiresAt: Date | null; grantExpiresAt: Date | null; scopes: string[];
}

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * The access token's end lives in the connection's existing `meta` column (the rebuild Prisma mirror does
 * not model it, as for other modules), under `accessTokenExpiresAt`. `tokenExpiresAt` is the grant's end.
 */
async function writeAccessExpiry(db: Db, workspaceId: string, socialAccountId: string, expiresAt: Date | null) {
  const patch = JSON.stringify({ accessTokenExpiresAt: expiresAt?.toISOString() ?? null });
  await db.$executeRaw`UPDATE social_accounts SET meta = COALESCE(meta, '{}'::jsonb) || ${patch}::jsonb WHERE id = ${socialAccountId} AND "workspaceId" = ${workspaceId}`;
}

async function readAccessExpiries(workspaceIds: readonly string[], ids: readonly string[]): Promise<Map<string, Date | null>> {
  const result = new Map<string, Date | null>();
  if (!ids.length) return result;
  const rows = await prisma.$queryRaw<Array<{ id: string; expires: string | null }>>`SELECT id, meta ->> 'accessTokenExpiresAt' AS expires FROM social_accounts WHERE id IN (${Prisma.join([...ids])}) AND "workspaceId" IN (${Prisma.join([...new Set(workspaceIds)])})`;
  for (const row of rows) {
    const date = row.expires ? new Date(row.expires) : null;
    result.set(row.id, date && Number.isFinite(date.getTime()) ? date : null);
  }
  return result;
}

type AccountRow = { id: string; accessToken: string; refreshToken: string | null; tokenExpiresAt: Date | null; scopes: string };
function readAccount(account: AccountRow, accessExpiresAt: Date | null): StoredToken {
  return {
    socialAccountId: account.id, accessToken: decryptSecret(account.accessToken), storedAccessToken: account.accessToken,
    refreshToken: account.refreshToken ? decryptSecret(account.refreshToken) : null, accessExpiresAt,
    grantExpiresAt: account.tokenExpiresAt, scopes: account.scopes.split(/[\s,]+/).filter(Boolean),
  };
}

/** Server-only: the credential currently stored for one destination of this workspace. Null when it is not usable. */
export async function readStoredToken(workspaceId: string, targetId: string, provider: string): Promise<StoredToken | null> {
  const target = await prisma.target.findFirst({
    where: { id: targetId, workspaceId, type: provider as TargetType, socialAccount: { is: { workspaceId, provider, invalidatedAt: null } } },
    select: { socialAccount: { select: { id: true, accessToken: true, refreshToken: true, tokenExpiresAt: true, scopes: true } } },
  });
  if (!target?.socialAccount) return null;
  const expiries = await readAccessExpiries([workspaceId], [target.socialAccount.id]);
  return readAccount(target.socialAccount, expiries.get(target.socialAccount.id) ?? null);
}

/** Accounts of one provider whose access token ends before `before`; background renewal reads these. */
export async function listAccountsToRenew(provider: string, before: Date, take: number) {
  const rows = await prisma.socialAccount.findMany({
    where: { provider, invalidatedAt: null, refreshToken: { not: null }, targets: { some: { enabled: true, type: provider as TargetType } } },
    select: { id: true, workspaceId: true, accessToken: true, refreshToken: true, tokenExpiresAt: true, scopes: true, targets: { where: { enabled: true }, select: { id: true }, take: 1 } },
    orderBy: { id: 'asc' }, take,
  });
  const expiries = await readAccessExpiries(rows.map(row => row.workspaceId), rows.map(row => row.id));
  return rows.map(row => ({ workspaceId: row.workspaceId, targetId: row.targets[0]?.id ?? null, token: readAccount(row, expiries.get(row.id) ?? null) }))
    .filter(row => row.targetId && (!row.token.accessExpiresAt || row.token.accessExpiresAt <= before));
}

/**
 * Save a renewed credential on the connection and every destination copy. Compare-and-set on the access
 * token that was renewed: a concurrent renewal wins and this one reports false so the caller rereads.
 */
export async function storeRenewedToken(input: {
  workspaceId: string; socialAccountId: string; previousStoredAccessToken: string; accessToken: string;
  refreshToken?: string | null; accessExpiresAt: Date | null; grantExpiresAt?: Date | null;
}): Promise<boolean> {
  return prisma.$transaction(async tx => {
    const encrypted = encryptSecret(input.accessToken);
    const changed = await tx.socialAccount.updateMany({
      where: { id: input.socialAccountId, workspaceId: input.workspaceId, invalidatedAt: null, accessToken: input.previousStoredAccessToken },
      data: {
        accessToken: encrypted, ...(input.refreshToken !== undefined ? { refreshToken: input.refreshToken ? encryptSecret(input.refreshToken) : null } : {}),
        ...(input.grantExpiresAt !== undefined ? { tokenExpiresAt: input.grantExpiresAt } : {}),
      },
    });
    if (changed.count !== 1) return false;
    await writeAccessExpiry(tx, input.workspaceId, input.socialAccountId, input.accessExpiresAt);
    await tx.target.updateMany({ where: { workspaceId: input.workspaceId, socialAccountId: input.socialAccountId }, data: { accessToken: encrypted } });
    return true;
  });
}

/** The provider refused the refresh grant: the customer must reconnect. Keeps destinations and history. */
export async function invalidateStoredConnection(workspaceId: string, socialAccountId: string, reason: string): Promise<void> {
  await prisma.socialAccount.updateMany({ where: { id: socialAccountId, workspaceId, invalidatedAt: null }, data: { invalidatedAt: new Date(), invalidReason: reason } });
}

export type RenewedToken = { accessToken: string; refreshToken?: string | null; accessExpiresAt: Date | null; grantExpiresAt?: Date | null };
export type RenewOutcome = 'renewed' | 'raced' | 'revoked' | 'unavailable' | 'not_renewable';

/**
 * Renew one stored connection with the module's refresh call. A provider that rejects the refresh grant
 * (HTTP 400/401) marks the connection revoked so the customer is asked to reconnect; any other failure
 * leaves the credential untouched for the next attempt.
 */
export async function renewStoredConnection(workspaceId: string, stored: StoredToken, refresh: (refreshToken: string) => Promise<RenewedToken>): Promise<{ outcome: RenewOutcome; accessToken: string }> {
  if (!stored.refreshToken) return { outcome: 'not_renewable', accessToken: stored.accessToken };
  let renewed: RenewedToken;
  try { renewed = await refresh(stored.refreshToken); }
  catch (error) {
    if (error instanceof ProviderHttpError && (error.status === 400 || error.status === 401)) {
      await invalidateStoredConnection(workspaceId, stored.socialAccountId, 'refresh_rejected');
      return { outcome: 'revoked', accessToken: stored.accessToken };
    }
    return { outcome: 'unavailable', accessToken: stored.accessToken };
  }
  const saved = await storeRenewedToken({ workspaceId, socialAccountId: stored.socialAccountId, previousStoredAccessToken: stored.storedAccessToken, ...renewed });
  return { outcome: saved ? 'renewed' : 'raced', accessToken: renewed.accessToken };
}

/**
 * The access token to use now for one destination. Renews first when the stored token ends within `leadMs`.
 * Falls back to the caller's token when the destination has no stored connection to renew.
 */
export async function freshStoredAccessToken(input: {
  workspaceId: string; targetId: string; provider: string; leadMs: number; fallback: string;
  refresh: (refreshToken: string) => Promise<RenewedToken>; now?: Date;
}): Promise<{ accessToken: string; outcome: RenewOutcome | 'fresh' }> {
  const stored = await readStoredToken(input.workspaceId, input.targetId, input.provider);
  if (!stored) return { accessToken: input.fallback, outcome: 'fresh' };
  const now = input.now ?? new Date();
  if (!stored.accessExpiresAt || stored.accessExpiresAt.getTime() - now.getTime() > input.leadMs) return { accessToken: stored.accessToken, outcome: 'fresh' };
  const result = await renewStoredConnection(input.workspaceId, stored, input.refresh);
  if (result.outcome === 'raced') {
    const reread = await readStoredToken(input.workspaceId, input.targetId, input.provider);
    return { accessToken: reread?.accessToken ?? result.accessToken, outcome: 'raced' };
  }
  return result;
}
