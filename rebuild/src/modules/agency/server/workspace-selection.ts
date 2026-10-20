import { cookies } from 'next/headers';
import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { isUsableLegacySession } from '@/server/auth';
import { prisma, getSessionByTokenHash } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { auditAccountMutation } from '@/server/account-settings';
import type { AccountActor } from '@/modules/settings/server/account';

export const workspaceSelectionConfirmation = (id: string) => `SELECT WORKSPACE ${id}`;

/** A workspace preference belongs to a current browser session, never to a bearer credential. */
export async function assertAgencySession(actor: AccountActor): Promise<void> {
  if (actor.apiKeyId || 'personKeyId' in actor || !actor.sessionTokenHash) throw new OperationError('forbidden', 'Use a signed-in browser session.');
  if (!isUsableLegacySession(await getSessionByTokenHash(actor.sessionTokenHash), actor.userId)) throw new OperationError('unauthorized', 'Sign in to continue.');
}

/**
 * Shared browser/MCP selection. Selecting a preference has no destructive consequence, so the
 * existing browser's explicit workspace selection is sufficient consent. If a confirmation is
 * supplied it must match exactly; MCP advertises it as required. This never grants membership.
 */
export async function selectWorkspace(actor: AccountActor, input: unknown) {
  await assertAgencySession(actor);
  const maxLength = await runtimeConfig('agency.workspaceIdMaxLength');
  const parsed = z.object({ workspaceId: z.string().min(1).max(maxLength), confirmation: z.string().optional() }).strict().safeParse(input);
  if (!parsed.success || (parsed.data.confirmation !== undefined && parsed.data.confirmation !== workspaceSelectionConfirmation(parsed.data.workspaceId))) throw new OperationError('invalid_request', 'Choose a valid workspace and matching confirmation.');
  const { workspaceId } = parsed.data;
  // Check membership before the workspace guard, so unrelated workspace status stays private.
  const membership = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId } }, select: { id: true } });
  if (!membership) throw new OperationError('not_found', 'Workspace not found.');
  const jar = await cookies();
  await withWorkspaceOperation(workspaceId, async () => {
    await assertAgencySession(actor);
    await prisma.$transaction(async tx => {
      // Lock the current session, user and membership through the audit against revocation.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT m.id FROM memberships m JOIN users u ON u.id = m."userId" JOIN sessions s ON s."userId" = u.id WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${workspaceId} AND u."disabledAt" IS NULL AND s."tokenHash" = ${actor.sessionTokenHash} AND s.pending IS NULL AND s."expiresAt" > NOW() FOR SHARE OF m, u, s`;
      if (!rows.length) throw new OperationError('not_found', 'Workspace not found.');
      await auditAccountMutation(tx, actor.userId, 'account.workspace_selected', { workspaceId });
    });
    jar.set('sp_workspace', workspaceId, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  });
  return { ok: true as const };
}
