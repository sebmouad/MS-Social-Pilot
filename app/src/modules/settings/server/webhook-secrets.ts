import { revealWebhookSecret, rotateWebhookSecret } from '@/modules/integrations/server/webhooks';
import { authorizeAccountSession, type AccountActor } from './account';

/** Secret-bearing actions require a current browser session. Existing bearer grants never gain secret access. */
export async function webhookSecretAction(actor: AccountActor, input: unknown, action: 'reveal' | 'rotate') {
  await authorizeAccountSession(actor, true, 'settings/webhooks');
  // The owning Integrations service enforces manager/tenant scope, exact confirmation, rate bounds and transactional audit.
  const identity = { userId: actor.userId, workspaceId: actor.workspaceId };
  return action === 'reveal' ? revealWebhookSecret(identity, input) : rotateWebhookSecret(identity, input);
}
