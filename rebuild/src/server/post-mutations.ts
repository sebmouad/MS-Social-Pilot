import { randomUUID } from "node:crypto";
import { prisma } from "./data";

const EDITOR_ROLES = new Set(["owner", "admin", "editor"]);
const AUTHOR_ROLES = new Set(["owner", "admin", "editor", "contributor"]);

export type PostMutationActor = { userId: string; workspaceId: string };

/**
 * Create a local draft. This intentionally does not create destination rows,
 * schedule delivery, or call a social provider.
 */
export async function createLocalDraft(actor: PostMutationActor, message: string) {
  const membership = await getCurrentMembership(actor);
  if (!AUTHOR_ROLES.has(membership.role)) throw new Error("You do not have permission to create drafts.");

  const now = new Date();
  return prisma.post.create({
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
}

/** Edit only an unconnected, unpublished draft in the actor's current workspace. */
export async function updateLocalDraft(actor: PostMutationActor, postId: string, message: string) {
  const membership = await getCurrentMembership(actor);
  if (!AUTHOR_ROLES.has(membership.role)) throw new Error("You do not have permission to edit drafts.");

  const ownsPost = membership.role === "contributor";
  const result = await prisma.post.updateMany({
    where: {
      id: postId,
      workspaceId: actor.workspaceId,
      status: "draft",
      publishedAt: null,
      ...(ownsPost ? { authorId: actor.userId } : {}),
      targets: { none: {} },
    },
    data: { message, updatedAt: new Date() },
  });
  if (result.count !== 1) throw new Error("This draft is unavailable or can no longer be edited.");
}

/**
 * Permanently remove only an unpublished draft with no destination rows.
 * The UI must ask for confirmation; this operation never contacts providers.
 */
export async function deleteLocalDraft(actor: PostMutationActor, postId: string) {
  const membership = await getCurrentMembership(actor);
  if (!AUTHOR_ROLES.has(membership.role)) throw new Error("You do not have permission to delete drafts.");

  const ownsPost = membership.role === "contributor";
  const result = await prisma.post.deleteMany({
    where: {
      id: postId,
      workspaceId: actor.workspaceId,
      status: "draft",
      publishedAt: null,
      ...(ownsPost ? { authorId: actor.userId } : {}),
      targets: { none: {} },
    },
  });
  if (result.count !== 1) throw new Error("This draft is unavailable or can no longer be deleted.");
}

async function getCurrentMembership(actor: PostMutationActor) {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } },
    select: { role: true },
  });
  if (!membership) throw new Error("You are no longer a member of this workspace.");
  return membership;
}
