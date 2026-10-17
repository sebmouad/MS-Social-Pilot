import type { PlatformAdapter, PlatformCredential } from '@/platforms/types';
import { connectionState, type ConnectionHealth } from '@/lib/connection-status';
import { decryptSecret } from '@/server/secret-crypto';

type CredentialTarget = { accessToken: string | null; socialAccount: (ConnectionHealth & { scopes: string }) | null };
type Operation = Parameters<NonNullable<PlatformAdapter['canUseCredential']>>[1];

/** Server-only readiness; returned cleartext must never enter a public projection. */
export function readPublishingCredential(target: CredentialTarget, adapter: Pick<PlatformAdapter, 'canUseCredential'>, operation: Operation, now = new Date()): PlatformCredential | null {
  const source = target.socialAccount;
  if (!source || connectionState(source, now) !== 'connected' || !target.accessToken) return null;
  try {
    const accessToken = decryptSecret(target.accessToken);
    if (!accessToken.trim()) return null;
    const credential = { accessToken, grantedScopes: source.scopes.split(',').map(scope => scope.trim()).filter(Boolean) };
    return adapter.canUseCredential?.(credential, operation) === false ? null : credential;
  } catch {
    // Invalid encryption or an unavailable adapter policy is not permission to dispatch.
    return null;
  }
}
