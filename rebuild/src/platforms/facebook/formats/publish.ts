import { FacebookApiError } from '../publishing';
import type { PublishRequest, PublishResult } from '../../types';
import { executeFacebookNativeWithJournal } from './journal';
import { planFacebookNative } from './plan';
import {
  FacebookAttemptStoreUnavailableError, FacebookNativePayloadConflictError, FacebookNativeValidationError,
  type FacebookNativeMedia, type FacebookNativePolicy, type FacebookNativeTransport,
} from './types';

/** Shared format identities declared by the Facebook module behind the private native switch. */
export const FACEBOOK_NATIVE_VIDEO_FORMAT_ID = 'video';
export const FACEBOOK_NATIVE_REEL_FORMAT_ID = 'reel';
export const isFacebookNativePublishFormat = (id: unknown): id is 'video' | 'reel' => id === FACEBOOK_NATIVE_VIDEO_FORMAT_ID || id === FACEBOOK_NATIVE_REEL_FORMAT_ID;

/** Trusted metadata derived from the exact bytes; caller-supplied media facts are never used. */
export interface FacebookNativeInspected { bytes: Uint8Array; mimeType: string; sizeBytes: number; width: number; height: number; durationSeconds?: number }

export interface FacebookNativePublishDeps {
  policy: FacebookNativePolicy;
  /** Signed Facebook transport for one Page credential; bounded by the request signal. */
  transport(accessToken: string, signal?: AbortSignal): Promise<FacebookNativeTransport>;
  /** Probe bytes the host already holds (stored media). */
  inspect(bytes: Uint8Array, signal?: AbortSignal): Promise<FacebookNativeInspected>;
  /** Fetch and probe a public HTTPS video through the guarded resolver. */
  resolveRemote(url: string, signal?: AbortSignal): Promise<FacebookNativeInspected>;
  execute?: typeof executeFacebookNativeWithJournal;
  now?: () => Date;
}

/** Nothing was sent: a definite rejection that releases the shared claim safely. */
const refused = (message: string) => new FacebookApiError(message, 400, 100);
const uncertain = (message: string) => new FacebookApiError(message, 0);

/**
 * Facebook-owned native publisher for the shared publish contract. It plans and
 * validates, then dispatches through the tenant-bound durable journal that sits
 * beneath the shared publication claim. Every non-submitted result is thrown so
 * the shared classifier decides: pre-dispatch validation is `rejected`; anything
 * that may have reached Facebook stays `uncertain` and is never resent.
 */
export function createFacebookNativePublisher(deps: FacebookNativePublishDeps) {
  const execute = deps.execute ?? executeFacebookNativeWithJournal;
  return async (request: PublishRequest): Promise<PublishResult> => {
    const format = request.formatId;
    if (!isFacebookNativePublishFormat(format)) throw refused('The selected publishing format is unavailable.');
    const publication = request.publication;
    if (!publication || !request.operationId) throw refused('This publication cannot be recorded. Try again from the post.');
    if (request.signal?.aborted) throw uncertain('Facebook operation was cancelled.');
    const items = request.media ?? [];
    if (items.length !== 1 || items[0]!.kind !== 'video') throw refused(format === 'reel' ? 'A Reel needs exactly one video.' : 'A video post needs exactly one video.');
    const item = items[0]!;
    let media: FacebookNativeMedia;
    try {
      if (item.localFile) {
        const inspected = await deps.inspect(item.localFile.bytes, request.signal);
        media = { kind: 'video', bytes: inspected.bytes, fileName: item.localFile.fileName, mimeType: inspected.mimeType,
          sizeBytes: inspected.sizeBytes, width: inspected.width, height: inspected.height,
          ...(inspected.durationSeconds !== undefined ? { durationSeconds: inspected.durationSeconds } : {}) };
      } else {
        const inspected = await deps.resolveRemote(item.url, request.signal);
        // A Reel is uploaded from the guarded snapshot; a video post lets Facebook fetch the URL and keeps only the probe facts.
        media = { kind: 'video', ...(format === 'reel' ? { bytes: inspected.bytes, mimeType: inspected.mimeType } : { url: item.url }),
          sizeBytes: inspected.sizeBytes, width: inspected.width, height: inspected.height,
          ...(inspected.durationSeconds !== undefined ? { durationSeconds: inspected.durationSeconds } : {}) };
      }
    } catch {
      throw refused('This video could not be checked. Choose a supported video file or a public HTTPS link.');
    }
    let plan;
    try {
      plan = planFacebookNative({ targetId: request.target.id, targetKind: request.target.kind, format: format === 'reel' ? 'reel' : 'post',
        ...(request.text ? { text: request.text } : {}), link: request.link ?? null, media: [media],
        scheduledAt: request.scheduledAt ?? null, now: (deps.now ?? (() => new Date()))(), policy: deps.policy });
    } catch (error) {
      if (error instanceof FacebookNativeValidationError) throw refused(error.message);
      throw refused('This video cannot be published in the selected format.');
    }
    let outcome;
    try {
      const transport = await deps.transport(request.credential.accessToken, request.signal);
      outcome = await execute({
        workspaceId: publication.workspaceId, operationId: request.operationId, postId: publication.postId,
        postTargetId: publication.postTargetId, targetId: publication.targetId, actorId: publication.actorId,
        remoteTargetId: request.target.id, sourceFormatId: format,
      }, plan, { transport });
    } catch (error) {
      if (error instanceof FacebookAttemptStoreUnavailableError || error instanceof FacebookNativePayloadConflictError) throw uncertain('The publishing record needs review before another attempt.');
      throw uncertain('The publishing outcome needs review. Check the Page before trying again.');
    }
    switch (outcome.status) {
      case 'submitted': return { remoteId: outcome.remoteId, url: null, state: 'submitted' };
      // Known staged objects mean a partial remote effect: hold for reconciliation rather than release the claim.
      case 'rejected': throw outcome.orphanIds.length ? uncertain('Facebook rejected a later step. Check the Page before trying again.') : new FacebookApiError(outcome.message, 400, outcome.code ?? 100);
      default: throw uncertain('The outcome at Facebook is unknown. Check the Page before trying again.');
    }
  };
}
