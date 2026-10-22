import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { canUseFeature, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { authorizeWorkspaceManager } from './workspace-policy';
import type { WorkspacePolicyActor } from '../workspace-policy';
import { normalizeWorkspaceOperations, workspaceOperationsConfirmation, workspaceOperationsInputSchema, workspaceOperationsValueSchema, type WorkspaceOperations } from '../workspace-operations';

const unavailable = () => new OperationError('unavailable', 'Workspace operations are temporarily unavailable. Try again later.');
const forbidden = () => new OperationError('forbidden', 'Workspace operations are managed by workspace owners and admins.');

type Row = Record<keyof WorkspaceOperations, unknown>;
async function selectRow(workspaceId: string) {
  const rows = await prisma.$queryRaw<Row[]>`SELECT "weekStartsOn", "businessDays", "businessStart", "businessEnd", "bestTimeMode", "utmSource", "utmMedium", "utmCampaignTemplate", "shortenerEnabled", "spamGapMinutes", "undoSendSeconds", "aiEnabled", "aiTone", "aiBrandVoice", "aiAvoidWords", "watchNegativeComments", "tasksAreaEnabled" FROM workspaces WHERE id = ${workspaceId}`;
  return rows[0];
}

/**
 * Unauthenticated service-side reader for consuming services (publishing link
 * preparation, undo window, inbox hours, AI prompts). Callers must already
 * hold authorized workspace scope.
 */
export async function loadWorkspaceOperations(workspaceId: string): Promise<WorkspaceOperations> {
  const row = await selectRow(workspaceId);
  if (!row) throw new OperationError('not_found', 'This workspace is unavailable.');
  return normalizeWorkspaceOperations(row);
}

export async function readWorkspaceOperations(actor: WorkspacePolicyActor) {
  try {
    await authorizeWorkspaceManager(actor, false);
    await assertWorkspaceNotPurging(actor.workspaceId);
    return { ok: true as const, settings: await loadWorkspaceOperations(actor.workspaceId) };
  } catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
}

export async function updateWorkspaceOperations(actor: WorkspacePolicyActor, input: unknown) {
  const envelope = workspaceOperationsInputSchema.safeParse(input);
  const value = envelope.success ? workspaceOperationsValueSchema.safeParse(envelope.data.settings) : null;
  if (!envelope.success || !value?.success) throw new OperationError('invalid_request', 'Choose valid workspace operations settings.');
  if (envelope.data.confirmation !== workspaceOperationsConfirmation(actor.workspaceId)) throw new OperationError('invalid_request', 'Enter the exact confirmation to save workspace operations.');
  try { await authorizeWorkspaceManager(actor, true); }
  catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
  let timeout: number, maxWait: number;
  try { [timeout, maxWait] = await Promise.all([runtimeConfig('settings.teamOperationTimeoutMs'), runtimeConfig('settings.teamOperationMaxWaitMs')]); }
  catch { throw unavailable(); }
  if (!Number.isSafeInteger(timeout) || !Number.isSafeInteger(maxWait)) throw unavailable();
  const next = value.data;
  try {
    return await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ id: string; suspendedAt: Date | null }>>`SELECT id, "suspendedAt" FROM workspaces WHERE id = ${actor.workspaceId} FOR UPDATE`;
      if (!rows[0]) throw new OperationError('not_found', 'This workspace is unavailable.');
      if (rows[0].suspendedAt) throw new OperationError('forbidden', 'This workspace is suspended.');
      const purge = await tx.workspaceDataPurge.findUnique({ where: { workspaceId: actor.workspaceId }, select: { status: true } });
      if (purge && purge.status !== 'completed') throw new OperationError('conflict', 'Workspace data deletion is in progress.');
      const current = await tx.$queryRaw<Array<{ role: string; disabledAt: Date | null }>>`SELECT m.role::text AS role, u."disabledAt" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR UPDATE OF m, u`;
      if (!current[0] || current[0].disabledAt) throw new OperationError('unauthorized', 'Your active workspace access changed. Sign in again to continue.');
      if (current[0].role !== 'owner' && current[0].role !== 'admin') throw forbidden();
      const [entitlements, permissions] = await Promise.all([loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId)]);
      if (!entitlements || entitlements.workspaceId !== actor.workspaceId || !canUseFeature(entitlements, 'settings/workspace') || !permissions || !canAccessFeature(permissions, 'settings/workspace', 'write')) throw forbidden();
      await tx.$executeRaw`UPDATE workspaces SET "weekStartsOn" = ${next.weekStartsOn}, "businessDays" = ${next.businessDays}::int[], "businessStart" = ${next.businessStart}, "businessEnd" = ${next.businessEnd}, "bestTimeMode" = ${next.bestTimeMode}, "utmSource" = ${next.utmSource}, "utmMedium" = ${next.utmMedium}, "utmCampaignTemplate" = ${next.utmCampaignTemplate}, "shortenerEnabled" = ${next.shortenerEnabled}, "spamGapMinutes" = ${next.spamGapMinutes}, "undoSendSeconds" = ${next.undoSendSeconds}, "aiEnabled" = ${next.aiEnabled}, "aiTone" = ${next.aiTone}, "aiBrandVoice" = ${next.aiBrandVoice}, "aiAvoidWords" = ${next.aiAvoidWords}, "watchNegativeComments" = ${next.watchNegativeComments}, "tasksAreaEnabled" = ${next.tasksAreaEnabled}, "updatedAt" = NOW() WHERE id = ${actor.workspaceId}`;
      // Audit records which fields changed shape, not free-text brand content.
      const detail = { ...next, aiBrandVoice: next.aiBrandVoice ? { characters: next.aiBrandVoice.length } : null, aiAvoidWords: next.aiAvoidWords ? { characters: next.aiAvoidWords.length } : null };
      await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'workspace.operations_updated', ${JSON.stringify(detail)}::jsonb, NOW())`;
      return { ok: true as const, settings: next };
    }, { timeout, maxWait });
  } catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
}
