"use server";

import { PublishingOperationError, publishingErrorClassificationMessage } from '../../error-catalog';
import { loadPublishingErrorText } from '../../server/error-copy';
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/server/context";
import { canAccessFeature } from "@/server/permissions";
import { reschedulePost } from "@/modules/publishing/server/lifecycle";
import { formatWhen, rescheduleFailureMessage } from "@/lib/reschedule";

export type RescheduleResult = { ok: true; scheduledAt: string; displayTime?: string } | { ok: false; error: string };

/** Move a scheduled post. The server re-checks scope, ownership, state, time zone and the past. */
export async function reschedulePostAction(input: { postId: string; date: string; time: string }): Promise<RescheduleResult> {
  try {
    const errorText = await loadPublishingErrorText();
    if (typeof input?.postId !== "string" || typeof input.date !== "string" || typeof input.time !== "string" || input.postId.length > 200) throw new PublishingOperationError('invalid_request', 'chooseAValidDateAndTime', {}, errorText);
    const viewer = await requireViewer({ feature: "publishing/calendar", channelScoped: true, write: true });
    if (!canAccessFeature(viewer.permissions, "publishing/calendar", "write")) throw new PublishingOperationError('forbidden', 'youCannotReschedulePosts', {}, errorText);
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId, ...(viewer.permissions.pageScope.all ? {} : { allowedTargetIds: viewer.permissions.pageScope.ids }) };
    const { scheduledAt } = await reschedulePost(actor, { postId: input.postId, date: input.date, time: input.time, timeZone: viewer.membership.workspace.timezone });
    revalidatePath("/content/calendar");
    revalidatePath("/content/queue");
    revalidatePath("/content");
    return { ok: true, scheduledAt: scheduledAt.toISOString(), displayTime: formatWhen(scheduledAt, viewer.membership.workspace.timezone) };
  } catch (error) {
    if (typeof error === "object" && error !== null && "digest" in error && typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT")) throw error;
    const canonical = publishingErrorClassificationMessage(error);
    const safeMessage = rescheduleFailureMessage(new Error(canonical));
    return { ok: false, error: safeMessage === canonical && error instanceof Error ? error.message : safeMessage };
  }
}
