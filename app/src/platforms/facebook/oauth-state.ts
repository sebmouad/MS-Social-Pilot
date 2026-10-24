import { timingSafeEqual, randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret } from '@/server/secret-crypto';

export const FACEBOOK_OAUTH_STATE_COOKIE = 'msp_facebook_oauth';

type PendingFacebookOAuth = { state: string; userId: string; workspaceId: string; expiresAt: number; scopes: string[] };

export function createFacebookOAuthState(userId: string, workspaceId: string, scopes: string[], ttlSeconds: number, now = Date.now()) {
  const pending: PendingFacebookOAuth = {
    state: randomBytes(32).toString('base64url'),
    userId,
    workspaceId,
    expiresAt: now + ttlSeconds * 1000,
    scopes,
  };
  return { state: pending.state, cookieValue: encryptSecret(JSON.stringify(pending)) };
}

/** Decrypt and bind callback state to the initiating session and workspace. */
export function openFacebookOAuthState(cookieValue: string | undefined, state: string | null, userId: string, workspaceId: string, now = Date.now()) {
  if (!cookieValue || !state || state.length > 256) return null;
  try {
    const pending = JSON.parse(decryptSecret(cookieValue)) as Partial<PendingFacebookOAuth>;
    if (typeof pending.state !== 'string' || typeof pending.userId !== 'string' || typeof pending.workspaceId !== 'string' || typeof pending.expiresAt !== 'number' || !Array.isArray(pending.scopes) || !pending.scopes.every(scope => typeof scope === 'string')) return null;
    const actual = Buffer.from(pending.state);
    const provided = Buffer.from(state);
    if (actual.length !== provided.length || !timingSafeEqual(actual, provided)) return null;
    if (pending.userId !== userId || pending.workspaceId !== workspaceId || pending.expiresAt <= now) return null;
    return { state: pending.state, userId: pending.userId, workspaceId: pending.workspaceId, expiresAt: pending.expiresAt, scopes: pending.scopes };
  } catch {
    return null;
  }
}
