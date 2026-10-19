import { createHash } from 'node:crypto';
import { prisma } from '@/server/data';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { decryptSecret } from '@/server/secret-crypto';
import { OperationError } from '@/lib/operation-error';
import { configuredFacebookNativeTransport } from '../runtime';
import type { FacebookNativeReadTransport } from './types';

export type FacebookNativeStatusBinding = {
  workspaceId: string;
  targetId: string;
  remoteTargetId: string;
};

type TargetSnapshot = {
  id: string;
  workspaceId: string;
  providerId: string;
  type: string;
  enabled: boolean;
  accessToken: string | null;
  socialAccount: {
    id: string;
    provider: string;
    workspaceId: string;
    scopes: string;
    invalidatedAt: Date | null;
    tokenExpiresAt: Date | null;
  } | null;
};

const unavailable = () => new OperationError('unavailable', 'Facebook native status reads are currently unavailable.');
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 2048 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function scopes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(scope => typeof scope !== 'string' || !scope.trim() || !/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(scope.trim()))) return [];
  return [...new Set(value.map(scope => (scope as string).trim()))].sort();
}

async function configTrust() {
  const [enabled, readScopes, graphBaseUrl, graphVersion, appSecretProofEnabled, requestTimeoutMs, appSecret] = await Promise.all([
    runtimeConfig('facebook.native.statusRecoveryEnabled'),
    runtimeConfig('meta.postReadScopes'),
    runtimeConfig('meta.graphBaseUrl'),
    runtimeConfig('meta.graphVersion'),
    runtimeConfig('meta.appSecretProofEnabled'),
    runtimeConfig('meta.requestTimeoutMs'),
    runtimeSecret('meta.appSecret').catch(() => null),
  ]);
  const requiredScopes = scopes(readScopes);
  if (enabled !== true || !requiredScopes.length || typeof graphBaseUrl !== 'string' || !graphBaseUrl ||
      typeof graphVersion !== 'string' || !graphVersion || typeof appSecretProofEnabled !== 'boolean' ||
      typeof requestTimeoutMs !== 'number' || !Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0 ||
      (appSecretProofEnabled && (typeof appSecret !== 'string' || !appSecret.trim()))) throw unavailable();
  return {
    requiredScopes,
    fingerprint: digest({ graphBaseUrl, graphVersion, appSecretProofEnabled, requestTimeoutMs, appSecret: appSecret ?? null }),
  };
}

async function current(binding: FacebookNativeStatusBinding) {
  const config = await configTrust();
  const target = await prisma.target.findFirst({
    where: { id: binding.targetId, workspaceId: binding.workspaceId, providerId: binding.remoteTargetId },
    select: { id: true, workspaceId: true, providerId: true, type: true, enabled: true, accessToken: true,
      socialAccount: { select: { id: true, provider: true, workspaceId: true, scopes: true, invalidatedAt: true, tokenExpiresAt: true } } },
  }) as TargetSnapshot | null;
  const connection = target?.socialAccount;
  if (!target || target.id !== binding.targetId || target.workspaceId !== binding.workspaceId || target.providerId !== binding.remoteTargetId ||
      target.enabled !== true || target.type !== 'page' || !connection || connection.provider !== 'facebook' ||
      connection.workspaceId !== binding.workspaceId || connection.invalidatedAt ||
      (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() <= Date.now()) ||
      typeof target.accessToken !== 'string' || !target.accessToken) throw unavailable();

  const grantedScopes = new Set(connection.scopes.split(/[\s,]+/).filter(Boolean));
  if (config.requiredScopes.some(scope => !grantedScopes.has(scope))) throw unavailable();
  let token: string;
  try { token = decryptSecret(target.accessToken); } catch { throw unavailable(); }
  if (!token.trim()) throw unavailable();
  return {
    token,
    configFingerprint: config.fingerprint,
    grantFingerprint: digest([...grantedScopes].sort()),
    connectionFingerprint: digest({ id: connection.id, workspaceId: connection.workspaceId, provider: connection.provider, invalidatedAt: connection.invalidatedAt, tokenExpiresAt: connection.tokenExpiresAt?.toISOString() ?? null }),
    tokenFingerprint: digest(token),
  };
}

/** Trusted Root host seam. The caller holds app_settings SHARE during preparation
 * so the trust snapshot and actual transport construction use one configuration epoch.
 * Construction is local and sends no request. */
export async function prepareFacebookNativeStatusRead(
  binding: FacebookNativeStatusBinding,
  signal?: AbortSignal,
): Promise<{ transport: FacebookNativeReadTransport; assertCurrent: () => Promise<void> }> {
  if (!validId(binding?.workspaceId) || !validId(binding?.targetId) || !validId(binding?.remoteTargetId)) throw unavailable();
  const pinned = Object.freeze({ workspaceId: binding.workspaceId, targetId: binding.targetId, remoteTargetId: binding.remoteTargetId });
  try {
    const snapshot = await current(pinned);
    const transport = await configuredFacebookNativeTransport(snapshot.token, { signal });
    const assertCurrent = async () => {
      try {
        const fresh = await current(pinned);
        if (fresh.configFingerprint !== snapshot.configFingerprint || fresh.grantFingerprint !== snapshot.grantFingerprint ||
            fresh.connectionFingerprint !== snapshot.connectionFingerprint || fresh.tokenFingerprint !== snapshot.tokenFingerprint) throw unavailable();
      } catch { throw unavailable(); }
    };
    await assertCurrent();
    return { transport, assertCurrent };
  } catch { throw unavailable(); }
}
