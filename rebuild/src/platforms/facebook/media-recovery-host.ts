import type { PlatformPublicationRecovery } from '@/server/platforms/host';
import { assertFacebookMediaResolution, assertFacebookMediaSettled, readFacebookMediaEvidence } from './media-journal';

/** Safety and private evidence stay available without constructing an API engine. */
export const facebookPublicationRecovery: PlatformPublicationRecovery = {
  assertSettled: assertFacebookMediaSettled,
  assertOutcome: assertFacebookMediaResolution,
  readEvidence: readFacebookMediaEvidence,
  async executeRootAction(userId, input) {
    if (['record_photo_present', 'record_feed_present', 'record_step_absent', 'record_photo_deleted', 'record_photo_still_present'].includes(input.actionId)) {
      const { resolveFacebookMedia } = await import('./media-resolution');
      return resolveFacebookMedia(userId, input);
    }
    const { cleanupFacebookMedia } = await import('./media-cleanup');
    return cleanupFacebookMedia(userId, input);
  },
};
