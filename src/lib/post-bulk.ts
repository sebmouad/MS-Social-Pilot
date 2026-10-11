import type { WorkspaceRole } from '@prisma/client';

import { prisma } from './prisma';
import { errors, AppError } from './errors';
import { assertPostInScope, type PageScope } from './page-access';
import { assertMayAct, cancelPost, updatePost } from './posts';
import { formatInZone } from './time';

/**
 * One action on several posts at once, from the post list's selection.
 *
 * Each post goes through the same checks as when acted on alone (scope, author
 * or editor, not yet published); a post that cannot take the action is
 * reported and the others go ahead.
 */

export const BULK_LIMIT = 100;

export type BulkAction =
  | { kind: 'cancel' }
  | { kind: 'shift'; days: number }
  | { kind: 'label'; labelId: string; add: boolean };

export interface BulkResult {
  done: number;
  /** Why each refused post was refused; `key` is a message key when it is ours. */
  failed: Array<{ id: string; message: string; key?: string; params?: Record<string, string | number> }>;
}

/** `yyyy-MM-ddTHH:mm` in the post's own zone, moved by whole days. */
export function shiftedLocal(scheduledAt: Date, timeZone: string, days: number): string {
  const local = formatInZone(scheduledAt, timeZone, "yyyy-MM-dd'T'HH:mm");
  const [date, time] = local.split('T') as [string, string];
  const moved = new Date(`${date}T12:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return `${moved.toISOString().slice(0, 10)}T${time}`;
}

export async function bulkPostAction(
  context: { workspaceId: string; userId: string; role: WorkspaceRole; requiresApproval: boolean; pageScope: PageScope },
  ids: string[],
  action: BulkAction,
): Promise<BulkResult> {
  const result: BulkResult = { done: 0, failed: [] };

  if (action.kind === 'label') {
    const label = await prisma.label.findFirst({ where: { id: action.labelId, workspaceId: context.workspaceId } });
    if (!label) throw errors.notFound();
  }

  for (const id of [...new Set(ids)].slice(0, BULK_LIMIT)) {
    try {
      await assertPostInScope(context.pageScope, context.workspaceId, id);
      const post = await prisma.post.findFirst({
        where: { id, workspaceId: context.workspaceId },
        select: { id: true, authorId: true, scheduledAt: true, timezone: true },
      });
      if (!post) throw errors.postNotFound();
      assertMayAct(post, context);

      if (action.kind === 'cancel') {
        const outcome = await cancelPost(context, id);
        if (outcome.failures.length > 0) throw new Error(outcome.failures.join(' '));
      } else if (action.kind === 'shift') {
        if (!post.scheduledAt) throw errors.noScheduledTime();
        await updatePost(context, id, {
          scheduledAtLocal: shiftedLocal(post.scheduledAt, post.timezone, action.days),
          timezone: post.timezone,
        });
      } else if (action.add) {
        // A label is how the team files a post, published or not: no edit rules apply.
        await prisma.postLabel.upsert({
          where: { postId_labelId: { postId: id, labelId: action.labelId } },
          create: { postId: id, labelId: action.labelId },
          update: {},
        });
      } else {
        await prisma.postLabel.deleteMany({ where: { postId: id, labelId: action.labelId } });
      }
      result.done += 1;
    } catch (error) {
      result.failed.push(
        error instanceof AppError
          ? { id, message: error.message, key: error.key, params: error.params as Record<string, string | number> }
          : { id, message: (error as Error).message },
      );
    }
  }
  return result;
}
