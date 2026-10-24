import { prisma } from '@/server/data';
import { publishingPostReadQuery } from './read-query';

/**
 * Posts waiting for the viewer's review, for the Approvals tab badge. It uses the same authorized read scope as the
 * Approvals list (current role, entitlement and channel limits), so a count never reveals posts the list would hide.
 * Any refusal or failure returns 0: a badge must never block a page.
 */
export async function pendingApprovalCount(actor: { userId: string; workspaceId: string }): Promise<number> {
  try {
    const query = await publishingPostReadQuery(actor, { status: 'pending_approval' }, 'publishing/approvals');
    return await prisma.post.count({ where: query.where });
  } catch {
    return 0;
  }
}
