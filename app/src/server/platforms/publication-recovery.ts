import type { Prisma } from '../../../generated/client';
import { platformModule } from '@/platforms';
import { facebookModule } from '@/platforms/facebook/module';
import { facebookPublicationRecovery } from '@/platforms/facebook/media-recovery-host';
import { instagramModule } from '@/platforms/instagram/module';
import { instagramPublicationRecovery } from '@/platforms/instagram/container-recovery';
import type { PlatformPublicationRecovery } from './host';

/** Explicit installed safety registration; importing it never constructs an API engine. */
const RECOVERY_HOSTS: Readonly<Record<string, PlatformPublicationRecovery>> = {
  [facebookModule.id]: facebookPublicationRecovery,
  [instagramModule.id]: instagramPublicationRecovery,
};

/** Installed safety evidence must not disappear when a module is disabled. */
export function installedPublicationRecovery(provider: string): PlatformPublicationRecovery | undefined {
  return platformModule(provider) ? RECOVERY_HOSTS[provider] : undefined;
}

export async function assertPlatformPublicationsSettled(tx: Prisma.TransactionClient, workspaceId: string, targetIds?: readonly string[]) {
  if (targetIds?.length === 0) return;
  for (const [provider, recovery] of Object.entries(RECOVERY_HOSTS)) {
    if (platformModule(provider)) await recovery.assertSettled(tx, workspaceId, targetIds);
  }
}

export async function assertPlatformPublicationOutcome(tx: Prisma.TransactionClient, provider: string, workspaceId: string, operationId: string, outcome: 'PUBLISHED' | 'ABSENT', remotePostId?: string) {
  await installedPublicationRecovery(provider)?.assertOutcome(tx, workspaceId, operationId, outcome, remotePostId);
}
