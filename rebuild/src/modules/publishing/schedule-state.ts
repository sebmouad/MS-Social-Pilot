/** Shared state eligibility for the reschedule service and its customer controls.
 * Authorization, current provider support and allowed times remain service checks.
 */
export function isWaitingToReschedule(post: {
  status: string;
  targets: ReadonlyArray<{ status: string; remotePostId: string | null }>;
}) {
  return post.status === 'scheduled' && post.targets.every(target =>
    target.status === 'scheduled_remote' || (target.status === 'pending' && !target.remotePostId));
}
