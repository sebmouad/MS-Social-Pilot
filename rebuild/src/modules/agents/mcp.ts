import type { McpToolGroup } from '@/server/mcp/kit';
import { OperationError } from '@/lib/operation-error';
import { writingAgents } from './server/service';
export const AGENTS_MCP: readonly McpToolGroup[] = [{
 id: 'agents',
 tools: [
  { name: 'list_writing_agents', description: 'Read saved workspace writing briefs or paged content-free suggestion history.', inputSchema: { type: 'object', properties: { action: { enum: ['list', 'history'] }, offset: { type: 'integer', minimum: 0 } }, additionalProperties: false } },
  { name: 'writing_agents', description: 'Save, delete a writing brief or prepare a metered post/reply suggestion for review. Exact confirmation: SAVE <trimmed name>, DELETE <id>, DRAFT <id>. Never sends or publishes.', inputSchema: { type: 'object', required: ['action'], properties: { action: { enum: ['save', 'delete', 'draft'] }, id: { type: 'string' }, name: { type: 'string' }, instructions: { type: 'string' }, voice: { type: 'string' }, text: { type: 'string' }, kind: { enum: ['post', 'reply'] }, confirmation: { type: 'string' } }, additionalProperties: false } },
 ],
 features: { writing_agents: 'agents/library', list_writing_agents: 'agents/library' },
 writeTools: ['writing_agents'], selfLockedWrites: ['writing_agents'], scope: { workspaceTools: ['writing_agents', 'list_writing_agents'] },
 execute: (viewer, name, args) => {
  if (name === 'list_writing_agents' && args.action !== undefined && args.action !== 'list' && args.action !== 'history' || name === 'writing_agents' && !['save', 'delete', 'draft'].includes(String(args.action))) throw new OperationError('invalid_request', 'Choose an available writing agent action.');
  return writingAgents({ userId: viewer.userId, workspaceId: viewer.workspaceId, permissionCeiling: viewer.permissions, apiKeyId: viewer.apiKeyId }, name === 'list_writing_agents' ? { action: 'list', ...args } : args);
 },
}];
