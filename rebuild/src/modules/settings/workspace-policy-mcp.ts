import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { workspacePolicyConfirmation } from './workspace-policy';
import { readWorkspacePolicy, updateWorkspacePolicy } from './server/workspace-policy';
import type { WorkspacePolicyActor } from './workspace-policy';
import { readWorkspaceOperations, updateWorkspaceOperations } from './server/workspace-operations';
import { WORKSPACE_OPERATION_BOUNDS as B } from './workspace-operations';

const text = (max: number) => ({ type: 'string', maxLength: max });
const operationsSettingsSchema = { type: 'object', additionalProperties: false, required: ['weekStartsOn', 'businessDays', 'businessStart', 'businessEnd', 'bestTimeMode', 'utmSource', 'utmMedium', 'utmCampaignTemplate', 'shortenerEnabled', 'spamGapMinutes', 'undoSendSeconds', 'aiEnabled', 'aiTone', 'aiBrandVoice', 'aiAvoidWords', 'watchNegativeComments'], properties: {
  weekStartsOn: { type: 'integer', minimum: 0, maximum: 6 }, businessDays: { type: 'array', maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 } }, businessStart: { type: 'integer', minimum: 0, maximum: 23 }, businessEnd: { type: 'integer', minimum: 1, maximum: 24 },
  bestTimeMode: { type: 'string', enum: ['suggest', 'apply'] }, utmSource: text(B.utmPart), utmMedium: text(B.utmPart), utmCampaignTemplate: text(B.utmCampaign), shortenerEnabled: { type: 'boolean' },
  spamGapMinutes: { type: 'integer', minimum: 0, maximum: B.spamGapMinutes }, undoSendSeconds: { type: 'integer', minimum: 0, maximum: B.undoSendSeconds }, aiEnabled: { type: 'boolean' }, aiTone: text(B.aiTone), aiBrandVoice: text(B.aiBrandVoice), aiAvoidWords: text(B.aiAvoidWords), watchNegativeComments: { type: 'boolean' },
} };

export const workspacePolicyTools = new Set(['get_workspace_policies', 'update_workspace_policies', 'get_workspace_operations', 'update_workspace_operations']);
export const workspacePolicyWriteTools = new Set(['update_workspace_policies', 'update_workspace_operations']);
export const workspacePolicyToolDefinitions = [
  { name: 'get_workspace_policies', description: 'Read the current workspace time zone and whether contributor posts require approval. Workspace owners and admins only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'update_workspace_policies', description: 'Set the workspace IANA time zone and contributor approval requirement. Exact confirmation: UPDATE WORKSPACE POLICY <workspaceId>. Contributor publishing uses the current policy. Turning approval off releases pending posts to their stored scheduled time or draft; content edits invalidate prior review.', inputSchema: { type: 'object', required: ['timezone', 'requiresApproval', 'confirmation'], properties: { timezone: { type: 'string', minLength: 1, maxLength: 128 }, requiresApproval: { type: 'boolean' }, confirmation: { type: 'string', maxLength: 400 } }, additionalProperties: false } },
  { name: 'get_workspace_operations', description: 'Read workspace operations settings: week start, business hours, best-time mode, UTM/link preparation, cross-channel spacing, undo-send window, AI voice and negative-comment moderation alerts. Workspace owners and admins only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'update_workspace_operations', description: 'Replace all workspace operations settings. Empty text clears a value. Exact confirmation: UPDATE WORKSPACE OPERATIONS <workspaceId>.', inputSchema: { type: 'object', required: ['settings', 'confirmation'], properties: { settings: operationsSettingsSchema, confirmation: { type: 'string', maxLength: 400 } }, additionalProperties: false } },
];
export async function executeWorkspacePolicyTool(actor: WorkspacePolicyActor, name: string, args: Record<string, unknown>) {
  if (name === 'get_workspace_policies') {
    if (Object.keys(args).length) throw new OperationError('invalid_request', 'This policy read takes no arguments.');
    return readWorkspacePolicy(actor);
  }
  if (name === 'get_workspace_operations') {
    if (Object.keys(args).length) throw new OperationError('invalid_request', 'This settings read takes no arguments.');
    return readWorkspaceOperations(actor);
  }
  if (name === 'update_workspace_operations') return updateWorkspaceOperations(actor, args);
  if (name !== 'update_workspace_policies') throw new OperationError('invalid_request', 'Unknown workspace policy action.');
  const value = z.object({ timezone: z.string().trim().min(1).max(128), requiresApproval: z.boolean(), confirmation: z.string().max(400) }).strict().safeParse(args);
  if (!value.success || value.data.confirmation !== workspacePolicyConfirmation(actor.workspaceId)) throw new OperationError('invalid_request', 'Choose valid workspace policies and confirm the exact action.');
  return updateWorkspacePolicy(actor, value.data);
}
