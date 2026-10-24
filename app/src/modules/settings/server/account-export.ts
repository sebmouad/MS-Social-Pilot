import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { auditAccountMutation } from '@/server/account-settings';
import { exportAccountSupplementaryData } from '@/server/data-control/account';
import { authorizeAccountSession, type AccountActor } from './account';

/** Personal safe-metadata snapshot. Never a workspace export or a full portability claim. */
export async function exportAccountData(actor: AccountActor, input: unknown = {}) {
  await authorizeAccountSession(actor);
  if (!z.object({}).strict().safeParse(input).success) throw new OperationError('invalid_request', 'Account exports take no arguments.');
  const [maxBytes, timeout, maxWait] = await Promise.all([
    runtimeConfig('data.maxArchiveBytes'),
    runtimeConfig('data.workspaceOperationTimeoutMs'),
    runtimeConfig('data.workspaceOperationLockWaitMs'),
  ]);
  return prisma.$transaction(async tx => {
    // Lock current account/session so disable, deletion or sign-out cannot pass the export boundary.
    const sessions = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT u.id FROM users u JOIN sessions s ON s."userId" = u.id
      WHERE u.id = ${actor.userId} AND u."disabledAt" IS NULL
        AND s."tokenHash" = ${actor.sessionTokenHash} AND s.pending IS NULL AND s."expiresAt" > NOW()
      FOR SHARE OF u, s`;
    if (!sessions.length) throw new OperationError('unauthorized', 'Sign in to continue.');
    // Legacy personal columns are intentionally absent from the reduced rebuild Prisma model.
    const profiles = await tx.$queryRaw<Array<{
      id: string; name: string; email: string; locale: string; pinnedMetrics: string[];
      emailVerifiedAt: Date | null; createdAt: Date; updatedAt: Date;
    }>>`SELECT id, name, email, locale::text, "pinnedMetrics", "emailVerifiedAt", "createdAt", "updatedAt"
        FROM users WHERE id = ${actor.userId}`;
    const profile = profiles[0];
    if (!profile) throw new OperationError('not_found', 'Account unavailable.');
    const supplementary = await exportAccountSupplementaryData(tx, actor.userId);
    const snapshot = {
      format: 'ms-social-pilot-account-export', version: 1, exportedAt: new Date().toISOString(),
      profile, ...supplementary,
      coverage: {
        complete: false,
        included: ['profile', 'storedAppearance', 'personCredentialMetadata', 'oauthGrantMetadata', 'legacyOauthGrantMetadata'],
        excluded: ['workspaceContent', 'media', 'passwords', 'credentialSecrets', 'authenticationHistory', 'notificationPreferences', 'auditHistory'],
      },
    };
    const content = JSON.stringify(snapshot);
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > maxBytes) throw new OperationError('unavailable', 'Your account export exceeds the download limit. Contact support.');
    await auditAccountMutation(tx, actor.userId, 'account.data_exported', { bytes, complete: false });
    // Fixed format/version and MIME are serialization protocol identifiers, not customer labels.
    return { format: snapshot.format, version: snapshot.version, mimeType: 'application/json' as const, bytes, content };
  }, { isolationLevel: 'RepeatableRead', timeout, maxWait });
}
