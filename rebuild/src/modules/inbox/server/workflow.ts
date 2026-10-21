import { inboxServiceText } from './service-copy';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { runtimeConfig } from '@/server/config/store';
import { authorizeInbox } from './access';
import type { InboxReadActor, InboxReadConstraints } from './types';

const inputSchema = z.object({ kind: z.enum(['message', 'comment', 'review']), id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), resolved: z.boolean() }).strict();
type WorkflowInput = z.infer<typeof inputSchema>;

async function findItem(actor: InboxReadActor, allowedChannelIds: string[], input: WorkflowInput) {
  if (!allowedChannelIds.length) return null;
  if (input.kind === 'review') {
    const rows = await prisma.$queryRaw<Array<{ targetId: string }>>`SELECT r."targetId" FROM page_reviews r JOIN targets t ON t.id = r."targetId" WHERE r.id = ${input.id} AND t."workspaceId" = ${actor.workspaceId} AND t.id = ANY(${allowedChannelIds})`;
    return rows[0] ? { id: input.id, targetId: rows[0].targetId } : null;
  }
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
  if (!parsed.success) throw new OperationError('invalid_request', await inboxServiceText('service48'));
  const value = parsed.data;
  const initialAccess = await authorizeInbox(actor, constraints, 'write');
  if (!await findItem(actor, initialAccess.channelIds, value)) throw new OperationError('not_found', await inboxServiceText('kindUnavailable', { kind: value.kind === 'message' ? 'conversation' : value.kind }));

  return withWorkspaceOperation(actor.workspaceId, async () => {
    // Refresh grants after a possible lock wait, immediately before local work.
    const access = await authorizeInbox(actor, constraints, 'write');
    if (!access.channelIds.length) throw new OperationError('not_found', await inboxServiceText('service7'));
    const [timeout, maxWait] = await Promise.all([runtimeConfig('inbox.workflowTransactionTimeoutMs'), runtimeConfig('inbox.workflowTransactionMaxWaitMs')]);
    return prisma.$transaction(async tx => {
      if (value.kind === 'review') {
        const resolvedAt = value.resolved ? new Date() : null;
        const rows = await tx.$queryRaw<Array<{ targetId: string }>>`UPDATE page_reviews r SET "resolvedAt" = ${resolvedAt}
          FROM targets t WHERE r.id = ${value.id} AND t.id = r."targetId" AND t."workspaceId" = ${actor.workspaceId} AND t.id = ANY(${access.channelIds}) RETURNING r."targetId"`;
        if (!rows[0]) throw new OperationError('not_found', await inboxServiceText('service6'));
        const reviewDetail = JSON.stringify({ workspaceId: actor.workspaceId, targetId: rows[0].targetId, itemId: value.id, kind: value.kind });
        await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.userId}, ${`inbox.review_${value.resolved ? 'resolved' : 'reopened'}`}, ${reviewDetail}::jsonb, NOW())`;
        return { ok: true, kind: value.kind, id: value.id, resolved: value.resolved };
      }
      const scope = value.kind === 'message'
        ? { id: value.id, targetId: { in: access.channelIds }, target: { workspaceId: actor.workspaceId } }
        : { id: value.id, parentRemoteId: null, postTarget: { targetId: { in: access.channelIds }, target: { workspaceId: actor.workspaceId }, post: { workspaceId: actor.workspaceId } } };
      const changed = value.kind === 'message'
        ? await tx.conversation.updateMany({ where: scope, data: { resolvedAt: value.resolved ? new Date() : null } })
        : await tx.postComment.updateMany({ where: scope, data: { resolvedAt: value.resolved ? new Date() : null } });
      if (!changed.count) throw new OperationError('not_found', await inboxServiceText('kindUnavailable', { kind: value.kind === 'message' ? 'conversation' : 'comment' }));
      const item = value.kind === 'message'
        ? await tx.conversation.findFirst({ where: scope, select: { targetId: true } })
        : await tx.postComment.findFirst({ where: scope, select: { postTarget: { select: { targetId: true } } } }).then(row => row ? { targetId: row.postTarget.targetId } : null);
      if (!item) throw new OperationError('not_found', await inboxServiceText('kindUnavailable', { kind: value.kind === 'message' ? 'conversation' : 'comment' }));
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
