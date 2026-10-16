const MANAGER_ROLES = new Set(['owner', 'admin', 'editor']);

/** Mirrors the route's author/manager explanation while the server remains authoritative. */
export function canCancelQueuedPost(input: { canWritePosts: boolean; role: string; userId: string; authorId: string }) {
  return input.canWritePosts && (MANAGER_ROLES.has(input.role) || input.authorId === input.userId);
}
