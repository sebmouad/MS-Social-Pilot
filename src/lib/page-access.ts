import { WorkspaceRole, type Prisma } from '@prisma/client';

import { atLeast } from './constants';
import { errors } from './errors';

/**
 * Which Pages a member may work on.
 *
 * An agency gives one freelancer the bakery's Pages and another the garage's,
 * inside the same workspace. A member whose access an admin has limited sees
 * only those Pages — in every list, every picker and every report — and every
 * route that takes a Page, or a post that names one, refuses the others.
 *
 * Owners and admins always have every Page: they are the people who set the
 * limits, and an admin limited to two Pages could simply lift the limit.
 *
 * Asked in one place, here, so a screen and the API it calls cannot disagree.
 */
export type PageScope = { all: true } | { all: false; ids: string[] };

export const ALL_PAGES: PageScope = { all: true };

export function scopeOf(membership: {
  role: WorkspaceRole;
  allPages: boolean;
  pages: Array<{ targetId: string }>;
}): PageScope {
  if (membership.allPages || atLeast(membership.role, WorkspaceRole.admin)) return ALL_PAGES;
  return { all: false, ids: membership.pages.map((row) => row.targetId) };
}

/** May this member work on this Page? */
export function mayUsePage(scope: PageScope, targetId: string): boolean {
  return scope.all || scope.ids.includes(targetId);
}

/**
 * A `where` for `prisma.target`, narrowed to the member's Pages. Spread it next
 * to the workspace id: `{ workspaceId, ...targetScope(auth.pageScope) }`.
 */
export function targetScope(scope: PageScope): Prisma.TargetWhereInput {
  return scope.all ? {} : { id: { in: scope.ids } };
}

/**
 * A `where` for `prisma.post`: posts that go to at least one of the member's
 * Pages. A post shared with a Page they cannot see is still theirs to see —
 * the half they can see — but not to change: see {@link assertPagesAllowed}.
 */
export function postScope(scope: PageScope): Prisma.PostWhereInput {
  return scope.all ? {} : { targets: { some: { targetId: { in: scope.ids } } } };
}

/** The same for a destination row. */
export function postTargetScope(scope: PageScope): Prisma.PostTargetWhereInput {
  return scope.all ? {} : { targetId: { in: scope.ids } };
}

/**
 * Refuse a write that names a Page outside the member's access.
 *
 * Raised as "unavailable" rather than "forbidden", the answer the API already
 * gives for an id from another workspace: a limited member is not told which
 * Pages exist beyond their own.
 */
export function assertPagesAllowed(scope: PageScope, targetIds: Iterable<string>): void {
  if (scope.all) return;
  for (const id of targetIds) {
    if (!scope.ids.includes(id)) throw errors.targetsUnavailable();
  }
}

/**
 * Refuse to act on a post that reaches a Page outside the member's access.
 *
 * Every destination has to be theirs, not just one: cancelling, retrying,
 * approving or editing a post changes it everywhere it goes, including on the
 * Page they were not given. Reported as "not found", like a post from another
 * workspace. A missing post is left to the route's own lookup to report.
 */
export async function assertPostInScope(
  scope: PageScope,
  workspaceId: string,
  postId: string,
): Promise<void> {
  if (scope.all) return;
  const { prisma } = await import('./prisma');
  const rows = await prisma.postTarget.findMany({
    where: { postId, post: { workspaceId } },
    select: { targetId: true },
  });
  if (rows.some((row) => !scope.ids.includes(row.targetId))) throw errors.postNotFound();
}

/**
 * For a route that reads or acts on one Page: a limited member must name a
 * Page, and it must be one of theirs. Members with every Page may leave it out
 * and get the whole workspace, as before.
 */
export function assertPageParam(scope: PageScope, targetId: string | null | undefined): void {
  if (scope.all) return;
  if (!targetId || !scope.ids.includes(targetId)) throw errors.targetsUnavailable();
}

/** The Page a stored comment or conversation belongs to, checked against the scope. */
export async function assertEngagementInScope(
  scope: PageScope,
  ref: { commentId: string } | { conversationId: string } | { postTargetId: string } | { externalPostId: string },
): Promise<void> {
  if (scope.all) return;
  const { prisma } = await import('./prisma');
  const targetId =
    'commentId' in ref
      ? (await prisma.postComment.findUnique({ where: { id: ref.commentId }, select: { postTarget: { select: { targetId: true } } } }))
          ?.postTarget.targetId
      : 'conversationId' in ref
        ? (await prisma.conversation.findUnique({ where: { id: ref.conversationId }, select: { targetId: true } }))?.targetId
        : 'postTargetId' in ref
          ? (await prisma.postTarget.findUnique({ where: { id: ref.postTargetId }, select: { targetId: true } }))?.targetId
          : (await prisma.externalPost.findUnique({ where: { id: ref.externalPostId }, select: { targetId: true } }))?.targetId;
  // Nothing found is left to the route, which already answers "not found".
  if (targetId && !scope.ids.includes(targetId)) throw errors.targetsUnavailable();
}
