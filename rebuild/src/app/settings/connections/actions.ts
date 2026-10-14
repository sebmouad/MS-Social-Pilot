"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewer } from "@/server/context";
import { setAdAccountSelection, setTargetSelection } from "@/server/connection-mutations";

const PATH = "/settings/connections";

export async function selectTargetAction(formData: FormData) {
  await mutate(formData, "targetId", setTargetSelection);
}

export async function selectAdAccountAction(formData: FormData) {
  await mutate(formData, "accountId", setAdAccountSelection);
}

async function mutate(formData: FormData, idField: string, operation: (actor: { userId: string; workspaceId: string }, id: string, enabled: boolean) => Promise<void>) {
  let notice = "failed";
  try {
    const id = readId(formData.get(idField));
    const enabledValue = formData.get("enabled");
    if (enabledValue !== "true" && enabledValue !== "false") throw new Error("Invalid selection.");
    const viewer = await requireViewer();
    await operation({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, id, enabledValue === "true");
    revalidatePath(PATH);
    notice = "saved";
  } catch (error) {
    if (isRedirect(error)) throw error;
  }
  redirect(`${PATH}?notice=${notice}`);
}

function readId(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error("Invalid connection.");
  return value;
}

function isRedirect(error: unknown) {
  return typeof error === "object" && error !== null && "digest" in error && typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT");
}
