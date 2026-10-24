"use server";

import { publishingErrorClassificationMessage } from '@/modules/publishing/error-catalog';
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewer } from "@/server/context";
import { canAccessFeature } from "@/server/permissions";
import { reviewPost } from "@/modules/publishing/server/lifecycle";

const PATH = "/content/approvals";

/** Approve or reject a post, optionally recording a short note with the decision. */
export async function reviewWithNoteAction(data: FormData) {
  let notice = "failed";
  try {
    const viewer = await requireViewer({ feature: "publishing/approvals", channelScoped: true, write: true });
    if (!canAccessFeature(viewer.permissions, "publishing/approvals", "write")) throw new Error("You cannot review posts.");
    const postId = data.get("postId");
    const decision = data.get("decision");
    const note = data.get("note");
    if (typeof postId !== "string" || (decision !== "approve" && decision !== "reject")) throw new Error("Choose an approval decision.");
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId, ...(viewer.permissions.pageScope.all ? {} : { allowedTargetIds: viewer.permissions.pageScope.ids }) };
    await reviewPost(actor, postId, decision, typeof note === "string" ? note : undefined);
    notice = decision === "approve" ? "approved" : "rejected";
    revalidatePath(PATH);
    revalidatePath("/content");
    revalidatePath("/content/queue");
  } catch (error) {
    if (typeof error === "object" && error !== null && "digest" in error && typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT")) throw error;
    const message = publishingErrorClassificationMessage(error);
    notice = /500 characters/.test(message) ? "failed-note" : /permission|cannot review|your own post/i.test(message) ? "failed-access" : "failed";
  }
  redirect(`${PATH}?notice=${notice}`);
}
