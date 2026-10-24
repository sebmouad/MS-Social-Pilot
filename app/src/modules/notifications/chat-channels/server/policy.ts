import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { chatCopySchema, chatPolicySchema } from '../config';

/** Fail closed until the integrator registers these declarations. */
export async function chatPolicy() {
  try { return chatPolicySchema.parse(await runtimeConfig('notifications.chatPolicy')); }
  catch { throw new OperationError('unavailable', 'Team chat configuration is unavailable.'); }
}
export async function chatCopy() {
  try { return chatCopySchema.parse(await runtimeConfig('notifications.chatCopy')); }
  catch { throw new OperationError('unavailable', 'Team chat copy is unavailable.'); }
}
