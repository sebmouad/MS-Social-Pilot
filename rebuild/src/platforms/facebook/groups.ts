import type { PlatformCredential, PlatformTarget, PublishRequest, PublishResult, RemoteStatus, RemoteStatusRequest } from '../types';
import type { FacebookConfig } from './config';
import { createFacebookEngine, FacebookApiError, type FacebookFetch } from './publishing';

/** Private compatibility transport, deliberately absent from the installed capability manifest.
 * Meta removed Groups API access across versions on 2024-04-22. Recorded grants
 * alone never establish availability; each write first needs positive discovery.
 * This is a provider port, not a workspace authorization/confirmation boundary.
 */
export interface FacebookGroupPolicy {
  discoveryScopes: readonly string[];
  publishScopes: readonly string[];
  readScopes: readonly string[];
}
export type FacebookGroupDiscovery =
  | { state: 'available'; targets: PlatformTarget[] }
  | { state: 'unavailable'; targets: []; reason: 'missing_grant' | 'provider_denied' };

/** Graph permission / retired-edge responses. Authentication, throttling,
 * transport failures and transient errors must retain their original meaning.
 */
function denied(error: unknown): boolean {
  return error instanceof FacebookApiError && !error.transient && error.status >= 400 && error.status < 500
    && error.status !== 429 && (error.code === 10 || error.code === 100 || error.code === 200);
}
function hasScopes(credential: PlatformCredential, required: readonly string[]): boolean {
  const scopes = required.map(scope => scope.trim()).filter(Boolean);
  const granted = new Set(credential.grantedScopes ?? []);
  return Boolean(credential.accessToken.trim()) && scopes.length > 0 && scopes.every(scope => granted.has(scope));
}
function validTarget(target: PlatformTarget): boolean {
  return target?.kind === 'group' && /^\d+$/.test(target.id);
}
function assertGroupIntent(request: PublishRequest) {
  if (!validTarget(request.target) || request.scheduledAt || (request.formatId !== undefined && request.formatId !== 'post')) {
    throw new FacebookApiError('Group publishing requires a Group feed destination without a provider-held schedule.', 400, 100);
  }
  // Single-create operations only. Page multi-photo staging and native video
  // journals must never be reused for Groups without their own protocol proof.
  const media = request.media ?? [];
  if (media.length > 1 || media.some(item => item.kind !== 'image') || (media.length && request.link?.trim())) {
    throw new FacebookApiError('Group publishing supports text, links or one photo.', 400, 100);
  }
}

export function createFacebookGroupOperations(config: FacebookConfig, policy: FacebookGroupPolicy, fetchImpl: FacebookFetch = fetch) {
  async function discover(credential: PlatformCredential, signal?: AbortSignal): Promise<FacebookGroupDiscovery> {
    if (!hasScopes(credential, policy.discoveryScopes)) return { state: 'unavailable', targets: [], reason: 'missing_grant' };
    try {
      return { state: 'available', targets: await createFacebookEngine(config, fetchImpl, signal).discoverGroups(credential.accessToken) };
    } catch (error) {
      if (denied(error)) return { state: 'unavailable', targets: [], reason: 'provider_denied' };
      throw error;
    }
  }
  async function isDiscovered(credential: PlatformCredential, target: PlatformTarget, signal?: AbortSignal): Promise<boolean> {
    if (!validTarget(target)) return false;
    const result = await discover(credential, signal);
    return result.state === 'available' && result.targets.some(item => item.id === target.id);
  }
  return {
    discover,
    async publish(request: PublishRequest): Promise<PublishResult> {
      assertGroupIntent(request);
      if (!hasScopes(request.credential, policy.publishScopes) || !await isDiscovered(request.credential, request.target, request.signal)) {
        throw new FacebookApiError('Group publishing is unavailable for this destination.', 400, 200);
      }
      const result = await createFacebookEngine(config, fetchImpl, request.signal).publish({
        targetId: request.target.id, targetKind: 'group', accessToken: request.credential.accessToken,
        text: request.text, link: request.link, media: request.media, operationId: request.operationId,
      });
      // Groups can require moderation. A create receipt is not proof the post is live.
      return { ...result, state: 'submitted' };
    },
    async getRemoteStatus(request: RemoteStatusRequest): Promise<RemoteStatus> {
      if (!validTarget(request.target) || (request.formatId !== undefined && request.formatId !== 'post')
        || !/^[A-Za-z0-9_:-]+$/.test(request.remoteId) || !hasScopes(request.credential, policy.readScopes)
        || !await isDiscovered(request.credential, request.target, request.signal)) return { state: 'unknown' };
      try {
        return await createFacebookEngine(config, fetchImpl, request.signal).getGroupStatus(request.credential.accessToken, request.remoteId, request.target.id);
      } catch (error) {
        if (denied(error)) return { state: 'unknown' };
        throw error;
      }
    },
  };
}
