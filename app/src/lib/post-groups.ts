/** Planned-vs-outcome grouping of post statuses (owner directive 2026-10-22): a glance answers "what is still to go out" vs "what went out". PLANNED covers every status where nothing was sent yet, including the transient `publishing` send; OUTCOME covers a finished send plus every resolved state. Per-destination outcomes stay separate; this groups the post-level status only. */
export const PLANNED_STATUSES = ['draft', 'pending_approval', 'scheduled', 'publishing'] as const;
export const OUTCOME_STATUSES = ['published', 'partially_failed', 'failed', 'cancelled', 'rejected'] as const;
export type PostGroup = 'planned' | 'outcome';

/**
 * The Posts page's three lists (owner directive 2026-11-08): what is still to go out, what went out, and what
 * needs a look. Every post-level status belongs to exactly one.
 */
export const POST_VIEWS = {
  planned: PLANNED_STATUSES,
  published: ['published'],
  issues: ['partially_failed', 'failed', 'rejected', 'cancelled'],
} as const;
export type PostView = keyof typeof POST_VIEWS;
export const POST_VIEW_IDS = Object.keys(POST_VIEWS) as PostView[];

/** The list a post-level status belongs to; an unknown status goes to Issues, where someone will look at it. */
export function postView(status: string): PostView {
  return POST_VIEW_IDS.find(view => (POST_VIEWS[view] as readonly string[]).includes(status)) ?? 'issues';
}

/** A list named in an address, or undefined when it names none. */
export function parsePostView(value: unknown): PostView | undefined {
  return typeof value === 'string' && (POST_VIEW_IDS as string[]).includes(value) ? value as PostView : undefined;
}

/** Group of a post-level status; an unknown status resolves to the outcome side so it never hides in "still to go out". */
export function postGroup(status: string): PostGroup {
  return (PLANNED_STATUSES as readonly string[]).includes(status) ? 'planned' : 'outcome';
}
