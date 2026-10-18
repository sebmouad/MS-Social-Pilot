import { withPublishingOperation, withPublishingTransaction } from '@/modules/publishing/server/guard';
import { randomUUID } from "node:crypto";
import { OperationError } from "@/lib/operation-error";
import { prisma } from "./data";
import { loadVersionRetention, recordPostVersion } from '@/modules/publishing/collaboration/server/versions';

const AUTHOR_ROLES = new Set(["owner", "admin", "editor", "contributor"]);

export type PostMutationActor = { userId: string; workspaceId: string };

/**
 * Create a local draft. This intentionally does not create destination rows,
 * schedule delivery, or call a social provider.
 */
export async function createLocalDraft(actor: PostMutationActor, message: string) {
  return withPublishingOperation(actor, {}, async ({ actor, signal }) => {
    signal.throwIfAborted();
    const membership = await getCurrentMembership(actor);
    if (!AUTHOR_ROLES.has(membership.role)) throw new OperationError('forbidden', "You do not have permission to create drafts.");
    const retention = await loadVersionRetention();

    const now = new Date();
    return withPublishingTransaction(signal, async tx => {
      const created = await tx.post.create({
        data: {
          id: randomUUID(),
          workspaceId: actor.workspaceId,
          authorId: actor.userId,
          message,
          status: "draft",
          scheduledAt: null,
          publishedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      });
      await recordPostVersion(tx, created.id, actor.userId, retention);
      await auditDraft(tx, actor, 'publishing.post_created', created.id);
      return created;
    });
  });
}

/** Edit only an unconnected, unpublished draft in the actor's current workspace. */
export async function updateLocalDraft(actor: PostMutationActor, postId: string, message: string) {
  return withPublishingOperation(actor, { postId }, async ({ actor, signal }) => {
    signal.throwIfAborted();
    const membership = await getCurrentMembership(actor);
    if (!AUTHOR_ROLES.has(membership.role)) throw new OperationError('forbidden', "You do not have permission to edit drafts.");
    const retention = await loadVersionRetention();

    const ownsPost = membership.role === "contributor";
    await withPublishingTransaction(signal, async tx => {
      const where = {
        id: postId,
        workspaceId: actor.workspaceId,
        status: "draft" as const,
        publishedAt: null,
        ...(ownsPost ? { authorId: actor.userId } : {}),
        targets: { none: {} },
      };
      const current = await tx.post.findFirst({ where, select: { id: true } });
      if (!current) throw new OperationError('conflict', "This draft is unavailable or can no longer be edited.");
      await recordPostVersion(tx, current.id, actor.userId, retention);
      const result = await tx.post.updateMany({
        where,
        data: { message, updatedAt: new Date() },
      });
      if (result.count !== 1) throw new OperationError('conflict', "This draft is unavailable or can no longer be edited.");
      await recordPostVersion(tx, current.id, actor.userId, retention);
      await auditDraft(tx, actor, 'publishing.post_updated', postId);
    });
  });
}

/**
 * Permanently remove only an unpublished draft with no destination rows.
 * The UI must ask for confirmation; this operation never contacts providers.
 */
export async function deleteLocalDraft(actor: PostMutationActor, postId: string) {
  return withPublishingOperation(actor, { postId }, async ({ actor, signal }) => {
    signal.throwIfAborted();
    const membership = await getCurrentMembership(actor);
    if (!AUTHOR_ROLES.has(membership.role)) throw new OperationError('forbidden', "You do not have permission to delete drafts.");

    const ownsPost = membership.role === "contributor";
    await withPublishingTransaction(signal, async tx => {
      const result = await tx.post.deleteMany({
        where: {
          id: postId,
          workspaceId: actor.workspaceId,
          status: "draft",
          publishedAt: null,
          ...(ownsPost ? { authorId: actor.userId } : {}),
          targets: { none: {} },
        },
      });
      if (result.count !== 1) throw new OperationError('conflict', "This draft is unavailable or can no longer be deleted.");
      await auditDraft(tx, actor, 'publishing.post_deleted', postId);
    });
  });
}

async function getCurrentMembership(actor: PostMutationActor) {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } },
    select: { role: true },
  });
  if (!membership) throw new OperationError('unauthorized', "You are no longer a member of this workspace.");
  return membership;
}

async function auditDraft(tx: import('../../generated/client').Prisma.TransactionClient, actor: PostMutationActor, action: string, postId: string) {
  await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.userId}, ${action}, ${JSON.stringify({ workspaceId: actor.workspaceId, postId, localDraft: true })}::jsonb, NOW())`;
}
