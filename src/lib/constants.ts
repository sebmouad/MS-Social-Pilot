import {
  ApprovalStatus,
  Locale,
  MediaKind,
  PostStatus,
  PostTargetStatus,
  PublishMode,
  StorageProvider,
  TargetType,
  WorkspaceRole,
} from '@prisma/client';

/**
 * Shared constants and role logic.
 *
 * The status types themselves are now Prisma enums generated from the database
 * schema, so an invalid value cannot be written at all — the previous
 * hand-maintained string unions and their type guards are gone. What remains
 * here is the domain logic *about* those values.
 */

export {
  ApprovalStatus,
  Locale,
  MediaKind,
  PostStatus,
  PostTargetStatus,
  PublishMode,
  StorageProvider,
  TargetType,
  WorkspaceRole,
};

export const WORKSPACE_ROLES = Object.values(WorkspaceRole);
export const POST_STATUSES = Object.values(PostStatus);
export const POST_TARGET_STATUSES = Object.values(PostTargetStatus);
export const PUBLISH_MODES = Object.values(PublishMode);
export const TARGET_TYPES = Object.values(TargetType);
export const LOCALES = Object.values(Locale);

/** Statuses that mean the scheduler is finished with a destination. */
export const TERMINAL_TARGET_STATUSES: readonly PostTargetStatus[] = [
  PostTargetStatus.published,
  PostTargetStatus.scheduled_remote,
  PostTargetStatus.failed,
  PostTargetStatus.cancelled,
  PostTargetStatus.skipped,
];

/**
 * Post states that hold a queue slot.
 *
 * A queued post's whole purpose is to space publications out, so anything that
 * still intends to go out at its time must count as occupying that slot —
 * including one waiting for review, which is the case that was missing. A
 * contributor's queued post sat in `pending_approval`, the next person to use
 * the queue was handed the same slot, and both went out together the moment the
 * first was approved. Drafts hold nothing (they have no time), and rejected or
 * cancelled posts release theirs, because they are not going out.
 */
export const QUEUE_OCCUPYING_STATUSES: readonly PostStatus[] = [
  PostStatus.scheduled,
  PostStatus.publishing,
  PostStatus.pending_approval,
];

/**
 * Approval states in which the scheduler may publish a post. Anything else —
 * notably `pending` — must never go out, whatever its scheduled time says.
 */
export const PUBLISHABLE_APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  ApprovalStatus.not_required,
  ApprovalStatus.approved,
];

/**
 * Facebook rejects scheduled_publish_time closer than 10 minutes or further
 * out than 30 days — "The publish date must be between 10 minutes and 30 days
 * from the time of the API request" (Pages API, Posts). This said six months,
 * which let anything between 30 days and six months through to be refused by
 * Graph with an opaque code 100 instead of a sentence here.
 */
export const NATIVE_SCHEDULE_MIN_SECONDS = 10 * 60;
export const NATIVE_SCHEDULE_MAX_SECONDS = 30 * 24 * 60 * 60;

/** Hard ceilings enforced before we bother calling Graph. */
export const LIMITS = {
  messageLength: 63_206,
  mediaPerPost: 10,
  targetsPerPost: 50,
  variantsPerPost: 10,
  /**
   * Raw size of an uploaded CSV. Not a product decision like the others — it
   * is the point past which parsing the string is itself the problem, and it
   * has to be checked before the row limit because the row limit needs the
   * parse to have finished.
   */
  bulkCsvBytes: 4 * 1024 * 1024,
} as const;

// ---------------------------------------------------------------------------
// Role capabilities
//
// Defined once, here, so a permission question has exactly one answer and the
// UI and the API cannot disagree about who may do what.
// ---------------------------------------------------------------------------

const ROLE_RANK: Record<WorkspaceRole, number> = {
  [WorkspaceRole.owner]: 4,
  [WorkspaceRole.admin]: 3,
  [WorkspaceRole.editor]: 2,
  [WorkspaceRole.contributor]: 1,
};

export function atLeast(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/**
 * The minimum role for each capability: the one table the `can…` functions
 * below read, and the one the privileges screen (root and Settings →
 * Permissions) prints for the owner's audit, so what is shown is what is
 * enforced. Changing a row changes who may do what — owner's audit first
 * (docs/ai/PERMISSIONS.md).
 */
export const CAPABILITIES = {
  manageAccounts: WorkspaceRole.admin,
  manageTeam: WorkspaceRole.admin,
  manageSettings: WorkspaceRole.admin,
  approve: WorkspaceRole.admin,
  deleteComments: WorkspaceRole.admin,
  moderateComments: WorkspaceRole.editor,
  publishWithoutApproval: WorkspaceRole.editor,
  manageOthersPosts: WorkspaceRole.editor,
  deleteMedia: WorkspaceRole.editor,
  manageTemplates: WorkspaceRole.editor,
  compose: WorkspaceRole.contributor,
} as const satisfies Record<string, WorkspaceRole>;

export type Capability = keyof typeof CAPABILITIES;

/** Highest role first, for tables. */
export const ROLES_BY_RANK: WorkspaceRole[] = [
  WorkspaceRole.owner,
  WorkspaceRole.admin,
  WorkspaceRole.editor,
  WorkspaceRole.contributor,
];

/** Connect, sync and disconnect Facebook accounts. */
export function canManageAccounts(role: WorkspaceRole): boolean {
  return atLeast(role, CAPABILITIES.manageAccounts);
}

/** Invite, remove and re-role members. */
export function canManageTeam(role: WorkspaceRole): boolean {
  return atLeast(role, CAPABILITIES.manageTeam);
}

/** Change workspace settings, queue times, branding, AI and UTM defaults. */
export function canManageSettings(role: WorkspaceRole): boolean {
  return atLeast(role, CAPABILITIES.manageSettings);
}

/**
 * Change instance-wide configuration: API credentials, job intervals, feature
 * switches.
 *
 * The installation's owner only — the person who created its first account —
 * and deliberately not a workspace role. These settings are not scoped to a
 * workspace: an agency admin for one client must not be able to change the
 * Graph version, or read out the fact that an API key is set, for every other
 * client on the installation. And owning *a* workspace proves nothing, because
 * everybody who registers is given one of their own to own; a role check here
 * let anyone invited as a contributor switch to that workspace and rewrite the
 * Facebook app credentials for everybody.
 *
 * Takes the auth context rather than a role for that reason, so a caller cannot
 * go back to asking the wrong question by passing `auth.role`.
 */
export function canManageInstance(auth: { isInstanceOwner: boolean }): boolean {
  return auth.isInstanceOwner === true;
}

/**
 * Hide, unhide and reply to comments on published posts.
 *
 * Editor and above. This is content work — the same people who write the posts
 * answer the replies — but it is not a contributor's, because every action here
 * is immediately visible on the client's page.
 */
export function canModerateComments(role: WorkspaceRole): boolean {
  return atLeast(role, CAPABILITIES.moderateComments);
}

/**
 * Delete a comment on Facebook.
 *
 * Admin and above, a step higher than hiding it. Hiding is reversible from the
 * same screen; deleting removes a customer's words from the client's page and
 * nothing brings them back.
 */
export function canDeleteComments(role: WorkspaceRole): boolean {
  return atLeast(role, CAPABILITIES.deleteComments);
}

/** Approve or reject posts submitted for review. */
export function canApprove(role: WorkspaceRole): boolean {
  return atLeast(role, CAPABILITIES.approve);
}

/**
 * Schedule directly, without review. Contributors cannot — that is the whole
 * point of the role — so in a workspace with approval turned on their posts
 * always route through the approval queue.
 */
export function canPublishWithoutApproval(role: WorkspaceRole): boolean {
  return atLeast(role, CAPABILITIES.publishWithoutApproval);
}

/** Everyone with a membership may write a post. */
export function canCompose(): boolean {
  return true;
}

/**
 * Delete a file from the media library.
 *
 * Editor and above, and deliberately not the same answer as uploading. Uploading
 * is unprivileged because contributors draft posts and would otherwise be unable
 * to do their job; deleting is the opposite shape. The library is shared — there
 * is no per-uploader ownership to fall back on — the file leaves the disk, and a
 * contributor who cannot publish their own words unread has no business
 * destroying a client's brand assets. The in-use guard is a separate question
 * and still applies: it stops a file going out from under a post that has not
 * been sent, whoever is asking.
 */
export function canDeleteMedia(role: WorkspaceRole): boolean {
  return atLeast(role, CAPABILITIES.deleteMedia);
}

/** Create, change and remove the workspace's post templates (NEXT_PHASES H4). */
export function canManageTemplates(role: WorkspaceRole): boolean {
  return atLeast(role, CAPABILITIES.manageTemplates);
}

/**
 * Edit, cancel, retry or publish a post somebody else wrote.
 *
 * Contributors are held to their own work. The role exists for people whose
 * output is reviewed, and someone who cannot publish their own words unread has
 * no business cancelling a colleague's scheduled campaign — a single call from
 * the wrong account would otherwise empty a client's calendar. Duplicating
 * another member's post is deliberately not covered: that creates a new post
 * authored by the copier, which faces review like anything else they write.
 */
export function canManageOthersPosts(role: WorkspaceRole): boolean {
  return atLeast(role, CAPABILITIES.manageOthersPosts);
}

/**
 * Parse a `?status=` query value into a Post filter.
 *
 * "failed" is deliberately widened to include partial failures: someone
 * filtering for failures wants to see a post where two of three destinations
 * went out, not just total losses.
 */
export function postStatusFilter(value: string | undefined): PostStatus[] | undefined {
  if (!value) return undefined;
  if (value === PostStatus.failed) return [PostStatus.failed, PostStatus.partially_failed];
  return POST_STATUSES.includes(value as PostStatus) ? [value as PostStatus] : undefined;
}

/**
 * Why a post can no longer be edited, or `null` when it still can.
 *
 * One rule, two callers. `updatePost` enforces it and turns each reason into
 * the error that explains it; the post list asks the same question to decide
 * whether to offer an Edit button. Written once so the two cannot drift — a
 * button that leads to a 409 is worse than no button.
 */
export type EditBlocker = 'publishing' | 'published' | 'scheduled_remote' | null;

/** A destination a worker is holding open right now. */
const IN_FLIGHT = 'processing';

export function postEditBlocker(post: {
  status: string;
  targets: Array<{ status: string }>;
}): EditBlocker {
  if (post.status === PostStatus.publishing) return 'publishing';
  if (post.status === PostStatus.published || post.status === PostStatus.partially_failed) {
    return 'published';
  }

  // A destination a worker has claimed, on a post that is still `scheduled`.
  // The post row does not turn `publishing` until an outcome comes back, so
  // this window is invisible at the post level and is exactly when an edit
  // does the most damage: replacing the destinations deletes the row the
  // worker is holding, and the post goes out on Facebook with nothing left to
  // record it — so the recreated row publishes it again.
  if (post.targets.some((target) => target.status === IN_FLIGHT)) return 'publishing';
  // Facebook is holding this one. Changing our copy would change nothing about
  // what goes out, which is the worst kind of edit: it looks like it worked.
  if (post.targets.some((target) => target.status === 'scheduled_remote')) {
    return 'scheduled_remote';
  }
  return null;
}

/**
 * Named `postIsEditable` rather than `canEditPost` on purpose: everything
 * called `can*` in this file answers a question about a *role*, and a test
 * sweeps them all to check no junior role outranks a senior one. Joining that
 * naming convention with a function that takes a post breaks the sweep.
 */
export function postIsEditable(post: {
  status: string;
  targets: Array<{ status: string }>;
}): boolean {
  return postEditBlocker(post) === null;
}

/**
 * The `targets.*` translation key naming a destination's kind.
 *
 * The catalogue has one key per {@link TargetType}, so this is nearly the
 * identity function. It exists because two screens were each writing the
 * mapping out as a ternary, and adding Instagram made both of them label it
 * "Page" — the second kind of bug a two-way branch grows into when a third
 * value arrives.
 */
export function targetTypeKey(type: string): string {
  return (TARGET_TYPES as readonly string[]).includes(type) ? type : TargetType.page;
}


/**
 * Instagram's caption limit, repeated here for the composer.
 *
 * The publishing module owns the rule and refuses anything past it. This is
 * the same number where a client component can see it, so somebody writing a
 * long caption is told while they are writing rather than hours later when the
 * post is due. Kept in step by a test.
 */
export const IG_CAPTION_LIMIT = 2_200;

/**
 * Why a destination cannot be published to.
 *
 * A code rather than a sentence, because the sentence is written by a
 * background job that has no idea who will read it — and half this product's
 * audience reads French. The text is still stored alongside as a fallback for
 * rows written before this existed, and for anything a future writer forgets
 * to give a code.
 */
export const TARGET_BLOCK_REASONS = [
  'role',
  'group_app',
  'inaccessible',
  'disconnected',
  'instagram_permission',
] as const;

export type TargetBlockReason = (typeof TARGET_BLOCK_REASONS)[number];

/**
 * The reasons a destination failed that are ours rather than Facebook's.
 *
 * `PostTarget.errorCode` also carries Facebook's own codes and error kinds.
 * Those keep their stored wording, because Facebook wrote it and it is the
 * informative part. These five are sentences this app composed, so they can be
 * said in the reader's language instead.
 */
export const OWN_TARGET_ERRORS = [
  'account_disconnected',
  'deleted_on_facebook',
  'destination_off',
  'worker_lost',
] as const;

export type OwnTargetError = (typeof OWN_TARGET_ERRORS)[number];

