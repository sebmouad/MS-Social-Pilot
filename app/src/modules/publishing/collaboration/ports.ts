import type { RestoreOptions, RestoreReview } from '../server/version-restore-plan';
import type { PublishingActor } from '../server/types';
import type { Prisma } from '../../../../generated/client';

/**
 * Integration ports the host wires at startup. Collaboration never edits posts
 * through its own SQL where publishing rules apply (restoring content), and it
 * does not claim abilities the host has not provided (recycling, mentions).
 */
export type VersionSnapshot = {
  versionId: string;
  message: string;
  firstComment: string | null;
  firstCommentDelayMinutes?: number;
  link: string | null;
  media: unknown;
  format: string;
  destinationFormats?: Record<string,string>;
  targetIds: string[];
  labelIds: string[];
  scheduledAt: Date | null;
  timezone: string;
};

/** Implemented by modules/publishing/server/lifecycle.ts. Restoring is an ordinary save: validation, destination
 * availability, approval reset, media checks, locks and a fresh version record all apply there. */
export interface VersionRestorePort {
  restorePostVersion(input: { actor: PublishingActor; postId: string; snapshot: VersionSnapshot } & RestoreOptions): Promise<{ postId: string; status: string; approvalReset: boolean; restored?: boolean; review?: RestoreReview }>;
}

/** Marks that a worker executes recycle rules (creates the repeats). Without it the recycle controls stay hidden. */
export interface RecycleExecutorPort { readonly available: true }

/** Persist notification intent with the note. SMTP delivery runs after commit in
 * its own worker; an SMTP failure never rolls back a saved note. */
export interface MentionNotifierPort {
  enqueueNoteMention(tx: Prisma.TransactionClient, input: { workspaceId: string; postId: string; noteId: string; authorId: string; recipientIds: readonly string[] }): Promise<{ queued: number }>;
}

/** Marks that the host schedules queued posts from queue_slots (lifecycle allocation reads the saved times). Without it the Queue times controls stay hidden. */
export interface QueueSchedulerPort { readonly available: true }
/** Marks that a worker runs the content-mix executor (see server/executors.ts runContentMix). Without it the Content mix controls stay hidden. */
export interface MixExecutorPort { readonly available: true }

export type CollaborationPorts = { versions?: VersionRestorePort; recycle?: RecycleExecutorPort; queue?: QueueSchedulerPort; mix?: MixExecutorPort; mentions?: MentionNotifierPort };
let current: CollaborationPorts = {};
export function registerCollaborationPorts(ports: CollaborationPorts) { current = { ...ports }; }
export function collaborationPorts(): Readonly<CollaborationPorts> { return current; }
/** What the customer screens may offer. */
export function collaborationCapabilities() { return { versionRestore: Boolean(current.versions), recycle: Boolean(current.recycle), queueTimes: Boolean(current.queue), contentMix: Boolean(current.mix), mentionNotifications: Boolean(current.mentions) }; }
