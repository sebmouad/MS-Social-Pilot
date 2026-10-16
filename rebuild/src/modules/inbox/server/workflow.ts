import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { runtimeConfig } from '@/server/config/store';
import { authorizeInbox } from './access';
import type { InboxReadActor, InboxReadConstraints } from './types';

const inputSchema = z.object({ kind: z.enum(['message', 'comment']), id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), resolved: z.boolean() }).strict();
type WorkflowInput = z.infer<typeof inputSchema>;

async function findItem(actor: InboxReadActor, allowedChannelIds: string[], input: WorkflowInput) {
  if (!allowedChannelIds.length) return null;
  if (input.kind === 'message') {
    return prisma.conversation.findFirst({
      where: { id: input.id, targetId: { in: allowedChannelIds }, target: { workspaceId: actor.workspaceId } },
      select: { id: true, targetId: true },
    });
  }
  return prisma.postComment.findFirst({
    where: { id: input.id, parentRemoteId: null, postTarget: { targetId: { in: allowedChannelIds }, target: { workspaceId: actor.workspaceId }, post: { workspaceId: actor.workspaceId } } },
    select: { id: true, postTarget: { select: { targetId: true } } },
  }).then(row => row ? { id: row.id, targetId: row.postTarget.targetId } : null);
}

/** Resolve/reopen stored Inbox state. This workflow makes no platform call. */
export async function setInboxWorkflowResolved(actor: InboxReadActor, input: unknown, constraints: InboxReadConstraints = {}) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', 'Choose a valid Inbox item and resolution state.');
  const value = parsed.data;
  const initialAccess = await authorizeInbox(actor, constraints, 'write');
  if (!await findItem(actor, initialAccess.channelIds, value)) throw new OperationError('not_found', `This ${value.kind === 'message' ? 'conversation' : 'comment'} is unavailable in the current workspace.`);

  return withWorkspaceOperation(actor.workspaceId, async () => {
    // Refresh grants after a possible lock wait, immediately before local work.
    const access = await authorizeInbox(actor, constraints, 'write');
    if (!access.channelIds.length) throw new OperationError('not_found', 'This Inbox item is unavailable in the current workspace.');
    const [timeout, maxWait] = await Promise.all([runtimeConfig('inbox.workflowTransactionTimeoutMs'), runtimeConfig('inbox.workflowTransactionMaxWaitMs')]);
    return prisma.$transaction(async tx => {
      const scope = value.kind === 'message'
        ? { id: value.id, targetId: { in: access.channelIds }, target: { workspaceId: actor.workspaceId } }
        : { id: value.id, parentRemoteId: null, postTarget: { targetId: { in: access.channelIds }, target: { workspaceId: actor.workspaceId }, post: { workspaceId: actor.workspaceId } } };
      const changed = value.kind === 'message'
        ? await tx.conversation.updateMany({ where: scope, data: { resolvedAt: value.resolved ? new Date() : null } })
        : await tx.postComment.updateMany({ where: scope, data: { resolvedAt: value.resolved ? new Date() : null } });
      if (!changed.count) throw new OperationError('not_found', `This ${value.kind === 'message' ? 'conversation' : 'comment'} is unavailable in the current workspace.`);
      const item = value.kind === 'message'
        ? await tx.conversation.findFirst({ where: scope, select: { targetId: true } })
        : await tx.postComment.findFirst({ where: scope, select: { postTarget: { select: { targetId: true } } } }).then(row => row ? { targetId: row.postTarget.targetId } : null);
      if (!item) throw new OperationError('not_found', `This ${value.kind === 'message' ? 'conversation' : 'comment'} is unavailable in the current workspace.`);
      const action = `inbox.${value.kind === 'message' ? 'conversation' : 'comment'}_${value.resolved ? 'resolved' : 'reopened'}`;
      const detail = JSON.stringify({ workspaceId: actor.workspaceId, targetId: item.targetId, itemId: value.id, kind: value.kind });
      await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.userId}, ${action}, ${detail}::jsonb, NOW())`;
      return { ok: true, kind: value.kind, id: value.id, resolved: value.resolved };
    }, { timeout, maxWait });
  });
}

/** Whether this actor can manage a locally stored item on the selected channel. */
export async function canManageInboxWorkflow(actor: InboxReadActor, targetId: string): Promise<boolean> {
  try {
    const access = await authorizeInbox(actor, {}, 'write');
    return access.channelIds.includes(targetId);
  } catch { return false; }
}
