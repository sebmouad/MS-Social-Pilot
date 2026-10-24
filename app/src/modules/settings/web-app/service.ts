import { z } from 'zod';
import { runtimeConfig } from '@/server/config/store';
import { prisma } from '@/server/data';
import { auditAccountMutation } from '@/server/account-settings';
import { OperationError } from '@/lib/operation-error';
import { authorizeAccountSession, type AccountActor } from '../server/account';

import { INSTALL_CONFIRMATION } from './protocol';
export { INSTALL_CONFIRMATION } from './protocol';
/** Public metadata contains only explicitly public installation branding, never workspace data. */
export const publicWebApp = () => runtimeConfig('settings.webApp');
export async function readWebApp(actor: AccountActor) {
  await authorizeAccountSession(actor, false, 'settings/appearance');
  return publicWebApp();
}
/** An audited request to prepare the browser ceremony, never a claim of installation success. */
export async function prepareWebApp(actor: AccountActor, input: unknown) {
  await authorizeAccountSession(actor, true, 'settings/appearance');
  const policy = await publicWebApp();
  if (!policy.enabled) throw new OperationError('forbidden', 'App installation is unavailable.');
  if (!z.object({ confirmation: z.literal(INSTALL_CONFIRMATION) }).strict().safeParse(input).success) throw new OperationError('invalid_request', 'Confirm app installation preparation.');
  await prisma.$transaction(async tx => {
    await authorizeAccountSession(actor, true, 'settings/appearance');
    await auditAccountMutation(tx, actor.userId, 'account.web_app_installation_prepared', { workspaceId: actor.workspaceId, browserConfirmationRequired: true });
  }, { timeout: policy.requestTimeoutMs, maxWait: policy.requestTimeoutMs });
  return { prepared: true, installed: false, browserConfirmationRequired: true };
}
