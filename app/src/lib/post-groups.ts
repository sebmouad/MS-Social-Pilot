/** Planned-vs-outcome grouping of post statuses (owner directive 2026-10-22): a glance answers "what is still to go out" vs "what went out". PLANNED covers every status where nothing was sent yet, including the transient `publishing` send; OUTCOME covers a finished send plus every resolved state. Per-destination outcomes stay separate; this groups the post-level status only. */
export const PLANNED_STATUSES = ['draft', 'pending_approval', 'scheduled', 'publishing'] as const;
export const OUTCOME_STATUSES = ['published', 'partially_failed', 'failed', 'cancelled', 'rejected'] as const;
export type PostGroup = 'planned' | 'outcome';

/** Group of a post-level status; an unknown status resolves to the outcome side so it never hides in "still to go out". */
export function postGroup(status: string): PostGroup {
  return (PLANNED_STATUSES as readonly string[]).includes(status) ? 'planned' : 'outcome';
}
