import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { prisma, getSessionByTokenHash } from '@/server/data';
import { isUsableSession } from '@/server/auth';
import { auditAccountMutation } from '@/server/account-settings';
import { loadEntitlements, canUseFeature, hasPlatformCapability } from '@/server/entitlements';
import { loadPermissions } from '@/server/permissions/loader';
import { canAccessFeature } from '@/server/permissions';
import { connectionFlow } from '@/server/platforms/registry';
import { withWorkspaceOperation, assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { persistTokenConnection } from '@/server/platforms/token-connection';
import { auditConnectionEvent } from '@/server/connection-mutations';
import type { PlatformCredentialForm } from '@/server/platforms/host';
import type { AccountActor } from './account';

export const connectionCredentialsConfirmation = (platform: string) => `CONNECT WITH CREDENTIALS ${platform}`;

/**
 * Credential-entry connections (app password, bot token). Same authority as the redirect flow: a signed-in
 * browser session of a current owner/admin with the Connections feature and the platform entitlement.
 * Secrets are validated by the module, stored encrypted by the shared persistence and never returned.
 */
async function authorize(actor: AccountActor, platform: string) {
  if (actor.apiKeyId || !actor.sessionTokenHash) throw new OperationError('forbidden', 'Use a signed-in browser session to connect an account.');
  if (!isUsableSession(await getSessionByTokenHash(actor.sessionTokenHash), actor.userId)) throw new OperationError('unauthorized', 'Sign in to continue.');
  const [membership, permissions, entitlements] = await Promise.all([
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } }),
    loadPermissions(actor.userId, actor.workspaceId),
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
  ]);
  if (!membership || !['owner', 'admin'].includes(membership.role) || !permissions || !canAccessFeature(permissions, 'settings/connections', 'write') || !entitlements || entitlements.workspaceId !== actor.workspaceId || !canUseFeature(entitlements, 'settings/connections')) throw new OperationError('forbidden', 'Only workspace owners and admins can connect accounts.');
  const flow = hasPlatformCapability(entitlements, platform) ? await connectionFlow(platform) : null;
  if (!flow?.credentials || !await flow.isReady()) throw new OperationError('unavailable', 'This connection is unavailable.');
  return flow.credentials;
}

export async function readConnectionCredentialForm(actor: AccountActor, platform: string, locale: 'en' | 'fr' = 'en'): Promise<PlatformCredentialForm & { platform: string; confirmation: string }> {
  const credentials = await authorize(actor, platform);
  return { platform, confirmation: connectionCredentialsConfirmation(platform), ...await credentials.form(locale) };
}

export async function connectWithCredentials(actor: AccountActor, input: unknown) {
  const parsed = z.object({ platform: z.string().min(1).max(40), fields: z.record(z.string().min(1).max(60), z.string().max(4096)), confirmation: z.string() }).strict().safeParse(input);
  if (!parsed.success || parsed.data.confirmation !== connectionCredentialsConfirmation(parsed.data.platform)) throw new OperationError('invalid_request', 'Confirm the account connection before continuing.');
  const { platform, fields } = parsed.data;
  return withWorkspaceOperation(actor.workspaceId, async () => {
    await assertWorkspaceNotPurging(actor.workspaceId);
    const credentials = await authorize(actor, platform);
    const form = await credentials.form('en');
    const allowed = new Set(form.fields.map(field => field.key));
    if (Object.keys(fields).some(key => !allowed.has(key)) || form.fields.some(field => !fields[field.key]?.trim() || fields[field.key]!.length > field.maxLength)) throw new OperationError('invalid_request', 'Fill in every field of the connection form.');
    let result;
    try { result = await credentials.connect(Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.trim()]))); }
    catch {
      try { await prisma.$transaction(tx => auditConnectionEvent(tx, { userId: actor.userId, workspaceId: actor.workspaceId }, `connection.${platform}_failed`, { stage: 'credentials' })); } catch { /* audit is best effort */ }
      throw new OperationError('upstream_failure', 'The credential could not be verified. Check it and try again.');
    }
    const saved = await persistTokenConnection({ userId: actor.userId, workspaceId: actor.workspaceId }, platform, result);
    await prisma.$transaction(tx => auditAccountMutation(tx, actor.userId, 'connection.credentials_connected', { workspaceId: actor.workspaceId, platform }));
    return { connected: true as const, platform, channels: saved.saved, skipped: saved.skipped };
  });
}
