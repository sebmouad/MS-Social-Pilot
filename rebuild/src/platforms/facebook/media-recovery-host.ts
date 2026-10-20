import type { PlatformPublicationRecovery } from '@/server/platforms/host';
import { assertFacebookMediaResolution, assertFacebookMediaSettled, readFacebookMediaEvidence } from './media-journal';
import { assertFacebookNativeResolution, assertFacebookNativeSettled, readFacebookNativeEvidence, readFacebookNativeProofEvidence, readFacebookNativeScheduleEvidence } from './formats/journal-recovery';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';

/** Safety and private evidence stay available without constructing an API engine. */
export const facebookPublicationRecovery: PlatformPublicationRecovery = {
  async assertSettled(tx, workspaceId, targetIds) {
    await assertFacebookMediaSettled(tx, workspaceId, targetIds);
    await assertFacebookNativeSettled(tx, workspaceId, targetIds);
  },
  async assertOutcome(tx, workspaceId, operationId, outcome, remotePostId) {
    await assertFacebookMediaResolution(tx, workspaceId, operationId, outcome, remotePostId);
    await assertFacebookNativeResolution(tx, workspaceId, operationId, outcome, remotePostId);
  },
  async readEvidence(operationId, resultCap) {
    const configured = await runtimeConfig('meta.mediaHistoryLimit');
    if (typeof configured !== 'number' || !Number.isSafeInteger(configured) || configured < 1 ||
      resultCap !== undefined && (!Number.isSafeInteger(resultCap) || resultCap < 1)) {
      throw new OperationError('unavailable', 'Publication evidence is temporarily unavailable.');
    }
    const cap = Math.min(configured, resultCap ?? configured);
    const [media, native, proofs, schedules] = await Promise.all([readFacebookMediaEvidence(operationId, cap), readFacebookNativeEvidence(operationId, cap), readFacebookNativeProofEvidence(operationId, cap), readFacebookNativeScheduleEvidence(operationId, cap)]);
    const merged = [...media.items, ...native.items, ...proofs.items, ...schedules.items].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    const items = merged.slice(0, cap);
    const visibleIds = new Set(items.map(row => row.id));
    const allColumns = [...media.columns, ...native.columns, ...proofs.columns, ...schedules.columns];
    const columns = allColumns.filter((column, index) => allColumns.findIndex(existing => existing.key === column.key) === index);
    return { title: 'Facebook publication evidence', description: 'Photo, feed and native delivery intents and receipts. Unresolved submissions are held for review and never resent automatically.',
      columns, summaryColumnKeys: ['state', 'recordType', 'remoteId', 'updatedAt'], items, rowIdKey: 'id', truncated: media.truncated || native.truncated || proofs.truncated || schedules.truncated || merged.length > cap,
      actions: [...(media.actions ?? []), ...(native.actions ?? [])].filter(action => visibleIds.has(action.rowId)) };
  },
  async executeRootAction(userId, input) {
    if (input.actionId === 'refresh_native_status') {
      const { refreshFacebookNativeStatus } = await import('./formats/status-recovery');
      return refreshFacebookNativeStatus(userId, input);
    }
    if (['record_photo_present', 'record_feed_present', 'record_step_absent', 'record_photo_deleted', 'record_photo_still_present'].includes(input.actionId)) {
      const { resolveFacebookMedia } = await import('./media-resolution');
      return resolveFacebookMedia(userId, input);
    }
    if (input.actionId !== 'delete_staged_photo') {
      throw new OperationError('invalid_request', 'Choose an available publication recovery action.');
    }
    const { cleanupFacebookMedia } = await import('./media-cleanup');
    return cleanupFacebookMedia(userId, input);
  },
};
