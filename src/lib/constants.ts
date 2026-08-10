/**
 * String unions that stand in for database enums.
 *
 * SQLite has no enum type, so these values are the contract instead. Every
 * write path validates against them (src/lib/validation.ts) and every read
 * path narrows through the type guards below.
 */

export const WORKSPACE_ROLES = ['owner', 'admin', 'member'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const TARGET_TYPES = ['page', 'group'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const POST_STATUSES = [
  'draft',
  'scheduled',
  'publishing',
  'published',
  'partially_failed',
  'failed',
  'cancelled',
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_TARGET_STATUSES = [
  'pending',
  'processing',
  'published',
  /**
   * Handed to Facebook with a `scheduled_publish_time`: the post exists
   * remotely but is not live yet, and our scheduler must leave it alone.
   */
  'scheduled_remote',
  'failed',
  'cancelled',
  'skipped',
] as const;
export type PostTargetStatus = (typeof POST_TARGET_STATUSES)[number];

export const PUBLISH_MODES = [
  /** Publish as soon as the request is handled. */
  'immediate',
  /** Hold in our database; the worker publishes at scheduledAt. */
  'worker',
  /** Hand the schedule to Facebook via scheduled_publish_time (Pages only). */
  'native',
] as const;
export type PublishMode = (typeof PUBLISH_MODES)[number];

export const MEDIA_KINDS = ['image', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export function isPostStatus(value: string): value is PostStatus {
  return (POST_STATUSES as readonly string[]).includes(value);
}

export function isPostTargetStatus(value: string): value is PostTargetStatus {
  return (POST_TARGET_STATUSES as readonly string[]).includes(value);
}

export function isTargetType(value: string): value is TargetType {
  return (TARGET_TYPES as readonly string[]).includes(value);
}

export function isPublishMode(value: string): value is PublishMode {
  return (PUBLISH_MODES as readonly string[]).includes(value);
}

/** Statuses that mean the scheduler is finished with a destination. */
export const TERMINAL_TARGET_STATUSES: readonly PostTargetStatus[] = [
  'published',
  'scheduled_remote',
  'failed',
  'cancelled',
  'skipped',
];

/**
 * Facebook rejects scheduled_publish_time closer than 10 minutes or further
 * out than 6 months (i.e. 75 days is fine, 200 days is not).
 */
export const NATIVE_SCHEDULE_MIN_SECONDS = 10 * 60;
export const NATIVE_SCHEDULE_MAX_SECONDS = 180 * 24 * 60 * 60;

/** Hard ceilings enforced before we bother calling Graph. */
export const LIMITS = {
  messageLength: 63_206,
  mediaPerPost: 10,
  targetsPerPost: 50,
} as const;
