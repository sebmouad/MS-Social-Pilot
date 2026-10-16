"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/server/context";
import { canAccessFeature } from "@/server/permissions";
import { reschedulePost } from "@/server/publishing/lifecycle";
import { formatWhen, rescheduleFailureMessage } from "@/lib/reschedule";

export type RescheduleResult = { ok: true; scheduledAt: string; displayTime?: string } | { ok: false; error: string };

/** Move a scheduled post. The server re-checks scope, ownership, state, time zone and the past. */
export async function reschedulePostAction(input: { postId: string; date: string; time: string }): Promise<RescheduleResult> {
  try {
    if (typeof input?.postId !== "string" || typeof input.date !== "string" || typeof input.time !== "string" || input.postId.length > 200) throw new Error("Choose a valid date and time.");
    const viewer = await requireViewer({ feature: "publishing/calendar", channelScoped: true, write: true });
    if (!canAccessFeature(viewer.permissions, "publishing/calendar", "write")) throw new Error("You cannot reschedule posts.");
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId, ...(viewer.permissions.pageScope.all ? {} : { allowedTargetIds: viewer.permissions.pageScope.ids }) };
    const { scheduledAt } = await reschedulePost(actor, { postId: input.postId, date: input.date, time: input.time, timeZone: viewer.membership.workspace.timezone });
    revalidatePath("/publishing/calendar");
    revalidatePath("/publishing/queue");
    revalidatePath("/publishing/posts");
    return { ok: true, scheduledAt: scheduledAt.toISOString(), displayTime: formatWhen(scheduledAt, viewer.membership.workspace.timezone) };
  } catch (error) {
    if (typeof error === "object" && error !== null && "digest" in error && typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT")) throw error;
    return { ok: false, error: rescheduleFailureMessage(error) };
  }
}
