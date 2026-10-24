'use server';
import { inboxServiceText } from '../server/service-copy';
import { inboxServiceCopy } from '../service-copy';

import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { bulkInboxAction } from '@/modules/inbox/server/bulk';
import type { BulkInboxResult } from '@/modules/inbox/bulk';

export type BulkActionOutcome = BulkInboxResult | { ok: false; error: string; code: string };

/**
 * Entry point for the Inbox bulk bar. Identity and channel scope come from the session here, never from the
 * request; the shared bulk service re-checks membership, permission, channel access and every confirmation.
 */
export async function runBulkInboxAction(input: unknown): Promise<BulkActionOutcome> {
  try {
    const viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true });
    const constraints = viewer.permissions.pageScope.all ? undefined : { allowedChannelIds: viewer.permissions.pageScope.ids };
    return await bulkInboxAction({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input, constraints);
  } catch (error) {
    const failure = operationFailure(error, await inboxServiceText('selectionFailed').catch(() => inboxServiceCopy.selectionFailed.en));
    return { ok: false, error: failure.error, code: failure.code };
  }
}
