import { FACEBOOK_STORY_STATUS_FIELDS, mapFacebookStoryStatus, mapFacebookVideoStatus } from './status';
import type { FacebookNativeReadTransport } from './types';

export interface FacebookNativeReadProofBinding {
  workspaceId: string;
  operationId: string;
  postId: string;
  postTargetId: string;
  targetId: string;
  actorId: string;
  remoteTargetId: string;
  sourceFormatId: string;
  format: 'video' | 'reel' | 'story_photo' | 'story_video';
  payloadHash: string;
  remoteId: string;
  revision: number;
}

export interface FacebookNativeReadProof extends Readonly<FacebookNativeReadProofBinding> {
  readonly outcome: 'published' | 'scheduled' | 'processing' | 'failed' | 'unknown';
  readonly detail: string | null;
  readonly observedAt: Date;
}

const fields = Object.freeze(['id', 'from', 'status', 'published', 'scheduled_publish_time']);
const validId = (v: unknown, limit = 2048): v is string => typeof v === 'string' && v.length > 0 &&
  v.length <= limit && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v) && /^[A-Za-z0-9_.:-]+$/.test(v);
const own = (v: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(v, k);
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function snapshot(input: FacebookNativeReadProofBinding): Readonly<FacebookNativeReadProofBinding> {
  // Copy only the declared scalar fields before the first await. This prevents
  // caller mutation during the request from changing the proof's binding.
  const value = {
    workspaceId: input.workspaceId, operationId: input.operationId, postId: input.postId,
    postTargetId: input.postTargetId, targetId: input.targetId, actorId: input.actorId,
    remoteTargetId: input.remoteTargetId, sourceFormatId: input.sourceFormatId,
    format: input.format, payloadHash: input.payloadHash, remoteId: input.remoteId,
    revision: input.revision,
  };
  for (const key of ['workspaceId', 'operationId', 'postId', 'postTargetId', 'targetId', 'actorId', 'remoteTargetId', 'remoteId'] as const) {
    if (!validId(value[key])) throw new TypeError('Invalid Facebook native read proof binding.');
  }
  const format: string = value.format as string;
  if (!validId(value.sourceFormatId, 128) || !/^[a-f0-9]{64}$/.test(value.payloadHash) ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      (format !== 'video' && format !== 'reel' && format !== 'story_photo' && format !== 'story_video')) {
    throw new TypeError('Invalid Facebook native read proof binding.');
  }
  return Object.freeze(value) as Readonly<FacebookNativeReadProofBinding>;
}

function proof(binding: Readonly<FacebookNativeReadProofBinding>, outcome: FacebookNativeReadProof['outcome'], detail: string | null, observedAt: Date): FacebookNativeReadProof {
  const at = Object.freeze(new Date(observedAt.getTime()));
  return Object.freeze({ ...binding, outcome, detail, observedAt: at });
}

/** One provider-owned, identity-bound read. It never writes or infers absence. */
export async function readFacebookNativeProof(
  bindingInput: FacebookNativeReadProofBinding,
  transport: FacebookNativeReadTransport,
  signal?: AbortSignal,
): Promise<FacebookNativeReadProof> {
  const binding = snapshot(bindingInput);
  const requestStartedAt = new Date();
  if (signal?.aborted) return proof(binding, 'unknown', 'aborted', requestStartedAt);

  if (binding.format === 'story_photo' || binding.format === 'story_video') {
    // A Story has no readable object of its own; the Page's Stories edge lists it by final post id.
    let listed: unknown;
    try {
      listed = await transport.getGraph(`${binding.remoteTargetId}/stories`, [...FACEBOOK_STORY_STATUS_FIELDS], signal);
    } catch {
      return proof(binding, 'unknown', signal?.aborted ? 'aborted' : 'read_failed', new Date());
    }
    const storyObservedAt = new Date();
    if (signal?.aborted) return proof(binding, 'unknown', 'aborted', storyObservedAt);
    if (!record(listed)) return proof(binding, 'unknown', 'status_shape_invalid', storyObservedAt);
    const story = mapFacebookStoryStatus(binding.remoteId, listed);
    return proof(binding, story.status === 'published' ? 'published' : 'unknown', story.detail, storyObservedAt);
  }
  if ((binding.format as string) !== 'video' && (binding.format as string) !== 'reel') return proof(binding, 'unknown', 'readback_unsupported', requestStartedAt);

  let raw: unknown;
  try {
    raw = await transport.getGraph(binding.remoteId, [...fields], signal);
  } catch {
    return proof(binding, 'unknown', signal?.aborted ? 'aborted' : 'read_failed', new Date());
  }
  const observedAt = new Date();
  if (signal?.aborted) return proof(binding, 'unknown', 'aborted', observedAt);
  if (!record(raw) || !own(raw, 'id') || raw.id !== binding.remoteId) return proof(binding, 'unknown', 'response_identity_mismatch', observedAt);
  if (!own(raw, 'from') || !record(raw.from) || !own(raw.from, 'id') || raw.from.id !== binding.remoteTargetId) {
    return proof(binding, 'unknown', 'response_target_mismatch', observedAt);
  }
  const status = raw.status;
  if (!own(raw, 'status') || !record(status) || !own(status, 'video_status') || !own(raw, 'published')) {
    return proof(binding, 'unknown', 'status_shape_invalid', observedAt);
  }
  if (binding.format === 'reel') {
    const phase = status.publishing_phase;
    if (!own(status, 'publishing_phase') || !record(phase) || !own(phase, 'status')) {
      return proof(binding, 'unknown', 'status_shape_invalid', observedAt);
    }
  }
  try {
    const mapped = mapFacebookVideoStatus(binding.format, raw);
    return proof(binding, mapped.status === 'missing' ? 'unknown' : mapped.status, mapped.detail, observedAt);
  } catch {
    return proof(binding, 'unknown', 'status_shape_invalid', observedAt);
  }
}
