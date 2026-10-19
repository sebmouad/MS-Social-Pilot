import type { ReportActor } from '../contracts';

/**
 * Whether the AI recap may be offered to this actor right now (AI on and configured, write access to Reports).
 * Customer choices omit the section otherwise; a stored choice is listed as not included when a report is made.
 */
export async function recapOffered(actor: Pick<ReportActor, 'userId' | 'workspaceId' | 'permissionCeiling'>): Promise<boolean> {
  try {
    const { summaryAvailable } = await import('@/modules/ai/server/ai');
    return await summaryAvailable({ userId: actor.userId, workspaceId: actor.workspaceId, permissionCeiling: actor.permissionCeiling });
  } catch { return false; }
}
