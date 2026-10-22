
import { runtimeConfig } from '@/server/config/store';
import { createMastodonAdapter, type MastodonSafeTransport } from './adapter';
import { mastodonPolicySchema } from './config';
/** Internal construction only; the shared authenticated connection host must bind
 * the persisted instance to its encrypted credential before calling this. */
export async function configuredMastodonAdapter(instance: string, transport: MastodonSafeTransport) {
  const policy = mastodonPolicySchema.parse(await runtimeConfig('mastodon.policy'));
  return createMastodonAdapter(policy, { instance, transport });
}

/** Server-only callback derivation; caller owns signed, single-use state. */
export async function mastodonRedirectUri(request: Request): Promise<string> {
  const policy = mastodonPolicySchema.parse(await runtimeConfig('mastodon.policy'));
  return new URL(policy.callbackPath, String(await runtimeConfig('app.publicOrigin'))).href;
}
