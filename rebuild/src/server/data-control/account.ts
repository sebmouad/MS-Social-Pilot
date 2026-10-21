import type { Prisma } from '../../../generated/client';
import { appearanceModeKey, exportAccountAppearance } from '@/modules/settings/server/appearance-data';

/**
 * Supplement the account export in its authorized transaction. Workspace recipes,
 * cursors and channel profiles belong to the workspace, not to an individual member.
 * This is a persistence hook, not an independently authorized UI/API/MCP service.
 */
export async function exportAccountSupplementaryData(tx: Prisma.TransactionClient, userId: string) {
  const [appearance, personCredentials, oauthGrants, legacyOauthGrants] = await Promise.all([
    exportAccountAppearance(tx, userId),
    // All credential payloads are excluded by explicit projections below.
    tx.$queryRaw`SELECT id, name, "readFeature", "expiresAt", "revokedAt", "createdAt" FROM person_mcp_keys WHERE "userId" = ${userId} ORDER BY "createdAt", id`,
    tx.$queryRaw`SELECT id, "clientId", "workspaceId", "readFeatures", "writeFeatures", "resourceScope", "expiresAt", "usedAt", "createdAt" FROM mcp_oauth_codes WHERE "userId" = ${userId} ORDER BY "createdAt", id`,
    tx.$queryRaw`SELECT id, "clientId", "workspaceId", scope, "expiresAt", "createdAt" FROM "OAuthCode" WHERE "userId" = ${userId} ORDER BY "createdAt", id`,
  ]);
  return { appearance, personCredentials, oauthGrants, legacyOauthGrants };
}

/**
 * Call after locking the user and validating deletion, immediately before DELETE users
 * in the same transaction. Other recent personal tables have user ON DELETE CASCADE;
 * the compatibility appearance key and legacy OAuth codes have no user FK. Never use a prefix/LIKE deletion here.
 */
export async function deleteAccountSupplementaryData(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`DELETE FROM "OAuthCode" WHERE "userId" = ${userId}`;
  return tx.appSetting.deleteMany({ where: { key: appearanceModeKey(userId) } });
}
