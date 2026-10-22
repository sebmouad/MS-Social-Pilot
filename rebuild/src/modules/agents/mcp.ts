import type { McpToolGroup } from '@/server/mcp/kit';
import { OperationError } from '@/lib/operation-error';
import { writingAgents } from './server/service';
import { scheduledAgents } from './server/scheduled';
export const AGENTS_MCP: readonly McpToolGroup[] = [{
 id: 'agents',
 tools: [
  { name: 'list_writing_agents', description: 'Read saved workspace writing briefs or paged content-free suggestion history.', inputSchema: { type: 'object', properties: { action: { enum: ['list', 'history'] }, offset: { type: 'integer', minimum: 0 } }, additionalProperties: false } },
  { name: 'writing_agents', description: 'Save, delete a writing brief or prepare a metered post/reply suggestion for review. Exact confirmation: SAVE <trimmed name>, DELETE <id>, DRAFT <id>. Never sends or publishes.', inputSchema: { type: 'object', required: ['action'], properties: { action: { enum: ['save', 'delete', 'draft'] }, id: { type: 'string' }, name: { type: 'string' }, instructions: { type: 'string' }, voice: { type: 'string' }, text: { type: 'string' }, kind: { enum: ['post', 'reply'] }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'list_scheduled_agents', description: 'Read workspace scheduled agents (channel, brief, weekday, drafts per week, active, last run) and the enabled channels one may write for.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'manage_scheduled_agent', description: 'Save, delete or immediately run a scheduled agent. A run writes drafts on the agent’s channel as its creator and counts towards the AI allowance; drafts are never scheduled or published, and a run is refused unless the agent is due. Exact confirmation: CREATE SCHEDULED AGENT, UPDATE SCHEDULED AGENT <id>, DELETE SCHEDULED AGENT <id>, RUN SCHEDULED AGENT <id>.', inputSchema: { type: 'object', required: ['action'], properties: { action: { enum: ['save', 'delete', 'run'] }, id: { type: 'string' }, targetId: { type: 'string' }, brief: { type: 'string' }, weekday: { type: 'integer', minimum: 0, maximum: 6 }, count: { type: 'integer', minimum: 1, maximum: 14 }, enabled: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
 ],
 features: { writing_agents: 'agents/library', list_writing_agents: 'agents/library', list_scheduled_agents: 'agents/library', manage_scheduled_agent: 'agents/library' },
 writeTools: ['writing_agents', 'manage_scheduled_agent'], selfLockedWrites: ['writing_agents', 'manage_scheduled_agent'], scope: { workspaceTools: ['writing_agents', 'list_writing_agents', 'list_scheduled_agents', 'manage_scheduled_agent'] },
 execute: (viewer, name, args) => {
  const actor = { userId: viewer.userId, workspaceId: viewer.workspaceId, permissionCeiling: viewer.permissions, apiKeyId: viewer.apiKeyId };
  if (name === 'list_writing_agents' && args.action !== undefined && args.action !== 'list' && args.action !== 'history' || name === 'writing_agents' && !['save', 'delete', 'draft'].includes(String(args.action))) throw new OperationError('invalid_request', 'Choose an available writing agent action.');
  if (name === 'list_scheduled_agents') return scheduledAgents(actor, { action: 'list' });
  if (name === 'manage_scheduled_agent' && !['save', 'delete', 'run'].includes(String(args.action))) throw new OperationError('invalid_request', 'Choose an available scheduled agent action.');
  if (name === 'manage_scheduled_agent') return scheduledAgents(actor, args);
  return writingAgents(actor, name === 'list_writing_agents' ? { action: 'list', ...args } : args);
 },
}];
