/**
 * Facebook-owned native publishing formats (video, Reel, Story, native schedule).
 * Graph paths, field names and body shapes are UNVERIFIED against live Graph;
 * they are carried over from the legacy app and covered by mocked tests only.
 */
export type FacebookNativeFormat = 'video' | 'reel' | 'story_photo' | 'story_video';

export interface FacebookNativeMedia {
  kind: 'image' | 'video';
  /** Public HTTPS URL the provider may fetch (file_url mode). */
  url?: string;
  /** Ephemeral bytes supplied server-side. Never persisted. */
  bytes?: Uint8Array;
  fileName?: string;
  mimeType?: string;
  /** Probed metadata used for limit checks; unknown values fail closed when a limit is configured. */
  sizeBytes?: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
}

export interface FacebookNativeRequest {
  targetId: string;
  /** Resource kind from discovery; only 'page' is eligible. */
  targetKind: string;
  format: 'post' | 'reel' | 'story';
  text?: string;
  link?: string | null;
  media: readonly FacebookNativeMedia[];
  /** Native (provider-held) schedule; only video supports it. */
  scheduledAt?: Date | null;
  now?: Date;
  /** Root-managed policy; defaults come from FACEBOOK_NATIVE_CONFIG defaults. */
  policy?: FacebookNativePolicy;
}

export interface FacebookMediaLimit {
  maxBytes: number; minDurationSeconds: number; maxDurationSeconds: number;
  /** width/height bounds, e.g. 0.5625 for 9:16. */
  minAspect: number; maxAspect: number;
}
export interface FacebookNativePolicy {
  scheduleMinSeconds: number; scheduleMaxSeconds: number;
  video: FacebookMediaLimit; reel: FacebookMediaLimit; storyVideo: FacebookMediaLimit; storyPhoto: FacebookMediaLimit;
  poll: { maxPolls: number; intervalMs: number };
}

export type FacebookNativePlan =
  | { format: 'video'; targetId: string; media: FacebookNativeMedia; description: string; scheduledUnix: number | null }
  | { format: 'reel'; targetId: string; media: FacebookNativeMedia; description: string }
  | { format: 'story_photo'; targetId: string; media: FacebookNativeMedia }
  | { format: 'story_video'; targetId: string; media: FacebookNativeMedia };

export type FacebookNativeIssueCode =
  | 'target_kind_unsupported' | 'format_requires_media' | 'single_video_required' | 'single_media_required'
  | 'mixed_media' | 'schedule_unsupported_for_format' | 'schedule_too_soon' | 'schedule_too_far'
  | 'media_source_missing' | 'media_metadata_missing' | 'media_too_large' | 'media_duration_out_of_range' | 'media_aspect_out_of_range' | 'media_url_not_https' | 'reel_text_too_long' | 'format_not_planned';

export class FacebookNativeValidationError extends Error {
  constructor(readonly code: FacebookNativeIssueCode, message: string) {
    super(message);
    this.name = 'FacebookNativeValidationError';
  }
}

/** Per-attempt outcome. `uncertain` must never be resent automatically. */
export type FacebookNativeOutcome =
  | { status: 'submitted'; remoteId: string; url: string | null; scheduled: boolean; steps: FacebookNativeStep[]; /** Submission receipt only; confirm with readFacebookNativeStatus before treating it as live. */ readbackRequired: true }
  | { status: 'rejected'; code: number | null; message: string; orphanIds: string[]; steps: FacebookNativeStep[]; throttle?: { retryAfterSeconds: number | null } }
  | { status: 'uncertain'; phase: string; knownIds: string[]; message: string; steps: FacebookNativeStep[]; throttle?: { retryAfterSeconds: number | null } }
  | { status: 'already_attempted'; previous: FacebookNativeAttemptRecord };

export interface FacebookNativeStep {
  phase: string;
  /** Write-ahead dispatch intent: the request MAY have been sent. Not wire proof. */
  dispatched: boolean;
  /** The transport returned a response; format-specific receipt checks still apply. */
  confirmed: boolean;
}

export interface FacebookNativeAttemptRecord {
  operationId: string;
  /** Exact snapshotted payload identity; absent only in older test/proposal records. */
  payloadHash?: string;
  format: FacebookNativeFormat;
  state: 'started' | 'published' | 'rejected' | 'uncertain' | 'confirmed' | 'deleted';
  knownIds: string[];
  /** Persisted phase intents and receipts; no media bytes or upload URLs. */
  steps?: FacebookNativeStep[];
  /** Page the objects belong to, needed for readback and reconciliation. */
  targetId?: string;
  remoteId?: string | null;
}

export class FacebookAttemptStoreUnavailableError extends Error {
  constructor() { super('The publishing attempt record is unavailable; nothing was sent.'); this.name = 'FacebookAttemptStoreUnavailableError'; }
}

export class FacebookNativePayloadConflictError extends Error {
  constructor() { super('This publishing operation already belongs to different content. Review its result before creating another operation.'); this.name = 'FacebookNativePayloadConflictError'; }
}

/** Durable idempotency port. begin() must be atomic: the first caller wins. */
export interface FacebookNativeAttemptStore {
  begin(record: FacebookNativeAttemptRecord): Promise<{ created: true } | { created: false; existing: FacebookNativeAttemptRecord }>;
  /**
   * `deleted` is terminal and never overwritten. With `expectedStates` the update is a compare-and-set
   * that applies only if the current state is one of them. Returns false when it was not applied.
   */
  update(operationId: string, patch: Partial<Pick<FacebookNativeAttemptRecord, 'state' | 'knownIds' | 'remoteId' | 'steps'>>,
    expectedStates?: ReadonlyArray<FacebookNativeAttemptRecord['state']>): Promise<boolean>;
  get(operationId: string): Promise<FacebookNativeAttemptRecord | null>;
}

/** Minimal parameterized SQL port (e.g. a pg Pool/client adapter). Never interpolate values. */
export interface FacebookSqlPort {
  query(sql: string, params: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Graph transport port. Implementations must throw FacebookApiError on non-2xx. */
export interface FacebookNativeTransport {
  postGraph(path: string, body: Record<string, string>): Promise<Record<string, unknown>>;
  /** Resumable upload to the provider-supplied upload address. */
  upload(uploadUrl: string, media: FacebookNativeMedia): Promise<void>;
}

/** Read/delete port for readback, polling, first comments and remote deletion. Throws FacebookApiError on non-2xx. */
export interface FacebookNativeReadTransport extends FacebookNativeTransport {
  getGraph(path: string, fields: string[]): Promise<Record<string, unknown>>;
  deleteGraph(path: string): Promise<Record<string, unknown>>;
}

/** Neutral publication status for shared code. */
export type FacebookNeutralStatus = 'published' | 'processing' | 'scheduled' | 'failed' | 'missing' | 'unknown';
export interface FacebookStatusReadback { status: FacebookNeutralStatus; detail: string | null; polls: number }
