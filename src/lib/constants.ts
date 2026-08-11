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
 * Approval states in which the scheduler may publish a post. Anything else —
 * notably `pending` — must never go out, whatever its scheduled time says.
 */
export const PUBLISHABLE_APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  ApprovalStatus.not_required,
  ApprovalStatus.approved,
];

/**
 * Facebook rejects scheduled_publish_time closer than 10 minutes or further
 * out than 6 months.
 */
export const NATIVE_SCHEDULE_MIN_SECONDS = 10 * 60;
export const NATIVE_SCHEDULE_MAX_SECONDS = 180 * 24 * 60 * 60;

/** Hard ceilings enforced before we bother calling Graph. */
export const LIMITS = {
  messageLength: 63_206,
  mediaPerPost: 10,
  targetsPerPost: 50,
  variantsPerPost: 10,
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

/** Connect, sync and disconnect Facebook accounts. */
export function canManageAccounts(role: WorkspaceRole): boolean {
  return atLeast(role, WorkspaceRole.admin);
}

/** Invite, remove and re-role members. */
export function canManageTeam(role: WorkspaceRole): boolean {
  return atLeast(role, WorkspaceRole.admin);
}

/** Change workspace settings, queue times, branding, AI and UTM defaults. */
export function canManageSettings(role: WorkspaceRole): boolean {
  return atLeast(role, WorkspaceRole.admin);
}

/**
 * Change instance-wide configuration: API credentials, job intervals, feature
 * switches.
 *
 * Owner only. These settings are not scoped to a workspace — an agency admin
 * for one client must not be able to change the Graph version, or read out the
 * fact that an API key is set, for every other client on the installation.
 */
export function canManageInstance(role: WorkspaceRole): boolean {
  return atLeast(role, WorkspaceRole.owner);
}

/**
 * Hide, unhide and reply to comments on published posts.
 *
 * Editor and above. This is content work — the same people who write the posts
 * answer the replies — but it is not a contributor's, because every action here
 * is immediately visible on the client's page.
 */
export function canModerateComments(role: WorkspaceRole): boolean {
  return atLeast(role, WorkspaceRole.editor);
}

/**
 * Delete a comment on Facebook.
 *
 * Admin and above, a step higher than hiding it. Hiding is reversible from the
 * same screen; deleting removes a customer's words from the client's page and
 * nothing brings them back.
 */
export function canDeleteComments(role: WorkspaceRole): boolean {
  return atLeast(role, WorkspaceRole.admin);
}

/** Approve or reject posts submitted for review. */
export function canApprove(role: WorkspaceRole): boolean {
  return atLeast(role, WorkspaceRole.admin);
}

/**
 * Schedule directly, without review. Contributors cannot — that is the whole
 * point of the role — so in a workspace with approval turned on their posts
 * always route through the approval queue.
 */
export function canPublishWithoutApproval(role: WorkspaceRole): boolean {
  return atLeast(role, WorkspaceRole.editor);
}

/** Everyone with a membership may write a post. */
export function canCompose(): boolean {
  return true;
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
  return atLeast(role, WorkspaceRole.editor);
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
