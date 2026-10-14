"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewer } from "@/server/context";
import { createLocalDraft, deleteLocalDraft, updateLocalDraft } from "@/server/post-mutations";

const POSTS_PATH = "/publishing/posts";
const MAX_MESSAGE_LENGTH = 10_000;

export async function createDraftAction(formData: FormData) {
  let notice = "failed";
  try {
    const message = readMessage(formData);
    const viewer = await requireViewer();
    await createLocalDraft({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, message);
    revalidatePath(POSTS_PATH);
    notice = "created";
  } catch (error) {
    if (isRedirect(error)) throw error;
  }
  redirect(`${POSTS_PATH}?notice=${notice}`);
}

export async function updateDraftAction(formData: FormData) {
  let notice = "failed";
  try {
    const postId = readId(formData);
    const message = readMessage(formData);
    const viewer = await requireViewer();
    await updateLocalDraft({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, postId, message);
    revalidatePath(POSTS_PATH);
    notice = "updated";
  } catch (error) {
    if (isRedirect(error)) throw error;
  }
  redirect(`${POSTS_PATH}?notice=${notice}`);
}

export async function deleteDraftAction(formData: FormData) {
  let notice = "failed";
  try {
    const postId = readId(formData);
    const viewer = await requireViewer();
    await deleteLocalDraft({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, postId);
    revalidatePath(POSTS_PATH);
    notice = "deleted";
  } catch (error) {
    if (isRedirect(error)) throw error;
  }
  redirect(`${POSTS_PATH}?notice=${notice}`);
}

function readMessage(formData: FormData) {
  const value = formData.get("message");
  if (typeof value !== "string") throw new Error("Post text is required.");
  const message = value.trim();
  if (!message || message.length > MAX_MESSAGE_LENGTH) throw new Error("Post text must be between 1 and 10,000 characters.");
  return message;
}

function readId(formData: FormData) {
  const value = formData.get("postId");
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error("Invalid post.");
  return value;
}

function isRedirect(error: unknown) {
  return typeof error === "object" && error !== null && "digest" in error && typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT");
}
