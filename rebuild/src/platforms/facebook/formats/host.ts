import { FacebookApiError } from '../publishing';
import type { PlatformCredential, PublishRequest, PublishResult } from '../../types';
import { planFacebookNative } from './plan';
import type { FacebookNativeJournalBinding } from './journal';
import type { FacebookNativeOutcome, FacebookNativePlan, FacebookNativePolicy, FacebookNativeTransport } from './types';

/** Authority snapshot produced by the shared publishing host after authorization
 * and claim creation. No caller-supplied field can create this authority.
 */
export type NativeHostBinding = FacebookNativeJournalBinding & {
  claimState: 'started';
  authorityFingerprint: string;
  credential: PlatformCredential;
  formatId: string;
};

export type FacebookNativeHostPolicy = {
  policy: FacebookNativePolicy;
  /** Same epoch included in the authorized binding fingerprint. */
  authorityFingerprint: string;
};

export interface FacebookNativeVideoPublisherDependencies {
  loadBinding(request: PublishRequest): Promise<NativeHostBinding>;
  resolveMedia(url: string, kind: 'video', signal?: AbortSignal): Promise<{
    bytes: Uint8Array; mimeType: string; sizeBytes: number; width: number; height: number; durationSeconds?: number;
  }>;
  loadPolicy(binding: NativeHostBinding): Promise<FacebookNativeHostPolicy>;
  transport(credential: PlatformCredential, signal?: AbortSignal): Promise<FacebookNativeTransport> | FacebookNativeTransport;
  execute(binding: NativeHostBinding, plan: FacebookNativePlan, transport: FacebookNativeTransport): Promise<FacebookNativeOutcome>;
}

function fail(): never { throw new FacebookApiError('Facebook video publishing is unavailable for this request.', 400, 100); }

function snapshotRequest(request: PublishRequest): PublishRequest {
  if (!request || typeof request !== 'object' || !request.credential || !request.target) return fail();
  const credential: PlatformCredential = {
    accessToken: request.credential.accessToken,
    ...(request.credential.grantedScopes ? { grantedScopes: [...request.credential.grantedScopes] } : {}),
  };
  const media = request.media?.map(item => ({
    kind: item.kind,
    url: item.url,
    ...(item.altText !== undefined ? { altText: item.altText } : {}),
    ...(item.localFile ? { localFile: { bytes: new Uint8Array(item.localFile.bytes), mimeType: item.localFile.mimeType, fileName: item.localFile.fileName } } : {}),
  }));
  return {
    credential,
    target: { id: request.target.id, name: request.target.name, kind: request.target.kind },
    ...(request.operationId !== undefined ? { operationId: request.operationId } : {}),
    ...(request.formatId !== undefined ? { formatId: request.formatId } : {}),
    text: request.text,
    ...(request.link !== undefined ? { link: request.link } : {}),
    ...(media !== undefined ? { media } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
  };
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && value === value.trim() && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value);
}

function validBinding(value: NativeHostBinding, request: PublishRequest): boolean {
  return !!value && value.claimState === 'started' && value.formatId === 'post' &&
    validId(value.workspaceId) && validId(value.operationId) && validId(value.postId) && validId(value.postTargetId) &&
    validId(value.targetId) && validId(value.actorId) && validId(value.remoteTargetId) && validId(value.sourceFormatId) &&
    value.sourceFormatId === 'post' && validId(value.authorityFingerprint) && value.remoteTargetId === request.target.id &&
    value.operationId === request.operationId &&
    value.credential?.accessToken === request.credential.accessToken &&
    JSON.stringify([...(value.credential.grantedScopes ?? [])].sort()) === JSON.stringify([...(request.credential.grantedScopes ?? [])].sort());
}

function sameAuthority(a: NativeHostBinding, b: NativeHostBinding): boolean {
  return a.workspaceId === b.workspaceId && a.operationId === b.operationId && a.postId === b.postId &&
    a.postTargetId === b.postTargetId && a.targetId === b.targetId && a.actorId === b.actorId &&
    a.remoteTargetId === b.remoteTargetId && a.sourceFormatId === b.sourceFormatId &&
    a.authorityFingerprint === b.authorityFingerprint && a.claimState === 'started' && b.claimState === 'started' &&
    a.credential.accessToken === b.credential.accessToken &&
    JSON.stringify([...(a.credential.grantedScopes ?? [])].sort()) === JSON.stringify([...(b.credential.grantedScopes ?? [])].sort());
}

/** Native feed-video bridge. It snapshots the mutable adapter request before the
 * first await, inspects the exact source bytes, then rechecks publication authority
 * before creating a transport or entering the existing scoped native journal.
 */
export function createFacebookNativeVideoPublisher(deps: FacebookNativeVideoPublisherDependencies) {
  return async (mutableRequest: PublishRequest): Promise<PublishResult> => {
    const request = snapshotRequest(mutableRequest);
    if (!request.operationId || !validId(request.operationId) || request.target.kind !== 'page' ||
        request.formatId !== 'post' || request.link != null || typeof request.text !== 'string' ||
        !Array.isArray(request.media) || request.media.length !== 1 || request.media[0]?.kind !== 'video' ||
        !!request.media[0]?.localFile || !validId(request.media[0]?.url)) return fail();
    request.signal?.throwIfAborted();

    const first = await deps.loadBinding(request);
    if (!validBinding(first, request)) return fail();
    const settings = await deps.loadPolicy(first);
    if (!settings || settings.authorityFingerprint !== first.authorityFingerprint) return fail();

    const inspected = await deps.resolveMedia(request.media[0].url, 'video', request.signal);
    request.signal?.throwIfAborted();
    if (!(inspected.bytes instanceof Uint8Array)) return fail();
    const inspectedBytes = new Uint8Array(inspected.bytes);
    const { mimeType, sizeBytes, width, height, durationSeconds } = inspected;
    if (inspectedBytes.byteLength === 0 || sizeBytes !== inspectedBytes.byteLength ||
        !/^video\/(?:mp4|webm|x-matroska)$/.test(mimeType) ||
        !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 ||
        !Number.isFinite(durationSeconds) || (durationSeconds ?? 0) <= 0) return fail();

    // Build the configured transport before the final authorization check. Its
    // factory is local-only; no provider request occurs until execute is called.
    const nativeTransport = await deps.transport(first.credential, request.signal);
    request.signal?.throwIfAborted();
    const second = await deps.loadBinding(request);
    if (!validBinding(second, request) || !sameAuthority(first, second)) return fail();

    // The plan contains only the inspected bytes and trusted metadata; the mutable
    // source URL and caller-provided media metadata never reach Graph.
    const plan = planFacebookNative({
      targetId: first.remoteTargetId,
      targetKind: 'page',
      format: 'post',
      text: request.text,
      link: null,
      media: [{ kind: 'video', bytes: inspectedBytes, mimeType,
        fileName: mimeType === 'video/mp4' ? 'video.mp4' : mimeType === 'video/webm' ? 'video.webm' : 'video.mkv',
        sizeBytes, width, height, durationSeconds }],
      policy: settings.policy,
    });
    const outcome = await deps.execute(second, plan, nativeTransport);
    if (outcome.status === 'submitted') return { remoteId: outcome.remoteId, url: null, state: 'submitted' };
    if (outcome.status === 'rejected' && outcome.orphanIds.length === 0 && outcome.steps.length === 1 &&
        outcome.steps[0]?.phase === 'video_create' && outcome.steps[0].dispatched && !outcome.steps[0].confirmed &&
        typeof outcome.code === 'number') {
      throw new FacebookApiError('Facebook rejected the video post.', 400, outcome.code);
    }
    // Unknown, orphaned, already-attempted, and otherwise unsettled results are
    // deliberately unclassified by FacebookApiError and stay held by the parent.
    throw new Error('The Facebook video outcome needs review before trying again.');
  };
}
