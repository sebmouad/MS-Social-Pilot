import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { workspacePolicyConfirmation } from './workspace-policy';
import { readWorkspacePolicy, updateWorkspacePolicy } from './server/workspace-policy';
import type { WorkspacePolicyActor } from './workspace-policy';

export const workspacePolicyTools = new Set(['get_workspace_policies', 'update_workspace_policies']);
export const workspacePolicyWriteTools = new Set(['update_workspace_policies']);
export const workspacePolicyToolDefinitions = [
  { name: 'get_workspace_policies', description: 'Read the current workspace time zone and whether contributor posts require approval. Workspace owners and admins only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'update_workspace_policies', description: 'Set the workspace IANA time zone and contributor approval requirement. Exact confirmation: UPDATE WORKSPACE POLICY <workspaceId>. Contributor publishing uses the current policy. Turning approval off releases pending posts to their stored scheduled time or draft; content edits invalidate prior review.', inputSchema: { type: 'object', required: ['timezone', 'requiresApproval', 'confirmation'], properties: { timezone: { type: 'string', minLength: 1, maxLength: 128 }, requiresApproval: { type: 'boolean' }, confirmation: { type: 'string', maxLength: 400 } }, additionalProperties: false } },
];
export async function executeWorkspacePolicyTool(actor: WorkspacePolicyActor, name: string, args: Record<string, unknown>) {
  if (name === 'get_workspace_policies') {
    if (Object.keys(args).length) throw new OperationError('invalid_request', 'This policy read takes no arguments.');
    return readWorkspacePolicy(actor);
  }
  if (name !== 'update_workspace_policies') throw new OperationError('invalid_request', 'Unknown workspace policy action.');
  const value = z.object({ timezone: z.string().trim().min(1).max(128), requiresApproval: z.boolean(), confirmation: z.string().max(400) }).strict().safeParse(args);
  if (!value.success || value.data.confirmation !== workspacePolicyConfirmation(actor.workspaceId)) throw new OperationError('invalid_request', 'Choose valid workspace policies and confirm the exact action.');
  return updateWorkspacePolicy(actor, value.data);
}
