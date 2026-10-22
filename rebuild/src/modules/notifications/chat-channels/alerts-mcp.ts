import type { RootMcpActor } from '@/server/mcp/types';
import { OperationError } from '@/lib/operation-error';
import { checkSystemAlerts, listSystemAlerts, testSystemAlert } from './server/alerts';

const confirmation = { type: 'object', required: ['confirmation'], properties: { confirmation: { type: 'string' } }, additionalProperties: false };
/** Integrate only with the installation MCP host, never workspace tool groups. */
export const systemAlertToolDefinitions = [
  { name: 'list_root_system_alerts', description: 'Read installation incident history without raw legacy detail. Installation owner only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'check_root_system_alerts', description: 'Reconcile worker, publication, disk and backup incidents. Unknown checks never resolve an incident. Exact confirmation: CHECK SYSTEM ALERTS. Installation owner only.', inputSchema: confirmation },
  { name: 'test_root_system_alert', description: 'Send one installation alert test to email and optional Telegram without retries. Review uncertain outcomes before repeating. Exact confirmation: TEST SYSTEM ALERT. Installation owner only.', inputSchema: confirmation },
] as const;
export async function executeSystemAlertTool(actor: RootMcpActor, name: string, input: Record<string, unknown>) {
  if (!actor.isInstanceOwner || actor.apiKeyId) throw new OperationError('forbidden', 'An installation-owner session is required.');
  switch (name) {
    case 'list_root_system_alerts': return listSystemAlerts(actor.userId);
    case 'check_root_system_alerts': return checkSystemAlerts(actor.userId, input.confirmation);
    case 'test_root_system_alert': return testSystemAlert(actor.userId, input.confirmation);
    default: throw new OperationError('invalid_request', 'Choose a supported installation alert action.');
  }
}
