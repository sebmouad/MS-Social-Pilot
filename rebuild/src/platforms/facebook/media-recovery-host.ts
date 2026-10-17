import type { PlatformPublicationRecovery } from '@/server/platforms/host';
import { assertFacebookMediaResolution, assertFacebookMediaSettled, readFacebookMediaEvidence } from './media-journal';

/** Safety and private evidence stay available without constructing an API engine. */
export const facebookPublicationRecovery: PlatformPublicationRecovery = {
  assertSettled: assertFacebookMediaSettled,
  assertOutcome: assertFacebookMediaResolution,
  readEvidence: readFacebookMediaEvidence,
  async executeRootAction(userId, input) {
    const { cleanupFacebookMedia } = await import('./media-cleanup');
    return cleanupFacebookMedia(userId, input);
  },
};
