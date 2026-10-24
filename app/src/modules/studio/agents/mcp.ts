import type { McpToolGroup } from '@/server/mcp/kit';
import { OperationError } from '@/lib/operation-error';
import { writingAgents } from './server/service';
import { scheduledAgents } from './server/scheduled';
import { autopilotTier } from './server/autopilot';
export const AGENTS_MCP: readonly McpToolGroup[] = [{
 id: 'agents',
 tools: [
  { name: 'list_writing_agents', description: 'Read saved workspace writing briefs or paged content-free suggestion history.', inputSchema: { type: 'object', properties: { action: { enum: ['list', 'history'] }, offset: { type: 'integer', minimum: 0 } }, additionalProperties: false } },
  { name: 'writing_agents', description: 'Save, delete a writing brief or prepare a metered post/reply suggestion for review. Exact confirmation: SAVE <trimmed name>, DELETE <id>, DRAFT <id>. Never sends or publishes.', inputSchema: { type: 'object', required: ['action'], properties: { action: { enum: ['save', 'delete', 'draft'] }, id: { type: 'string' }, name: { type: 'string' }, instructions: { type: 'string' }, voice: { type: 'string' }, text: { type: 'string' }, kind: { enum: ['post', 'reply'] }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'list_scheduled_agents', description: 'Read workspace scheduled agents (channel, brief, weekday, drafts per week, active, last run), the enabled channels one may write for, and recent run history (newest first, from the audit trail).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'manage_scheduled_agent', description: 'Save, delete or immediately run a scheduled agent. A run writes drafts on the agent’s channel as its creator and counts towards the AI allowance; a manual run never schedules or publishes, and a run is refused unless the agent is due. Only the supervised-auto tier lets the worker schedule drafts, inside the workspace guardrails. Exact confirmation: CREATE SCHEDULED AGENT, UPDATE SCHEDULED AGENT <id>, DELETE SCHEDULED AGENT <id>, RUN SCHEDULED AGENT <id>.', inputSchema: { type: 'object', required: ['action'], properties: { action: { enum: ['save', 'delete', 'run'] }, id: { type: 'string' }, targetId: { type: 'string' }, brief: { type: 'string' }, weekday: { type: 'integer', minimum: 0, maximum: 6 }, count: { type: 'integer', minimum: 1, maximum: 14 }, enabled: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'manage_autopilot_tier', description: 'Change the workspace autopilot tier (manual: nothing automatic; assisted: drafts only; supervised_auto: drafts are scheduled inside guardrails). Owners and admins only. Guardrails narrow the installation ceilings: most automatic sends per day, quiet hours, schedulable channels, drafts-only channels. Exact confirmation: SET AUTOPILOT TIER <tier>.', inputSchema: { type: 'object', required: ['tier', 'confirmation'], properties: { tier: { enum: ['manual', 'assisted', 'supervised_auto'] }, guardrails: { type: 'object', properties: { maxSendsPerDay: { type: 'integer', minimum: 0, maximum: 200 }, quietStartHour: { type: 'integer', minimum: 0, maximum: 23 }, quietEndHour: { type: 'integer', minimum: 0, maximum: 23 }, targetIds: { type: 'array', items: { type: 'string' } }, draftsOnlyTargetIds: { type: 'array', items: { type: 'string' } } }, additionalProperties: false }, confirmation: { type: 'string' } }, additionalProperties: false } },
 ],
 features: { writing_agents: 'studio/agents', list_writing_agents: 'studio/agents', list_scheduled_agents: 'studio/agents', manage_scheduled_agent: 'studio/agents', manage_autopilot_tier: 'studio/agents' },
 writeTools: ['writing_agents', 'manage_scheduled_agent', 'manage_autopilot_tier'], selfLockedWrites: ['writing_agents', 'manage_scheduled_agent', 'manage_autopilot_tier'], scope: { workspaceTools: ['writing_agents', 'list_writing_agents', 'list_scheduled_agents', 'manage_scheduled_agent', 'manage_autopilot_tier'] },
 execute: (viewer, name, args) => {
  const actor = { userId: viewer.userId, workspaceId: viewer.workspaceId, permissionCeiling: viewer.permissions, apiKeyId: viewer.apiKeyId };
  if (name === 'list_writing_agents' && args.action !== undefined && args.action !== 'list' && args.action !== 'history' || name === 'writing_agents' && !['save', 'delete', 'draft'].includes(String(args.action))) throw new OperationError('invalid_request', 'Choose an available writing agent action.');
  if (name === 'list_scheduled_agents') return scheduledAgents(actor, { action: 'list' });
  if (name === 'manage_scheduled_agent' && !['save', 'delete', 'run'].includes(String(args.action))) throw new OperationError('invalid_request', 'Choose an available scheduled agent action.');
  if (name === 'manage_scheduled_agent') return scheduledAgents(actor, args);
  if (name === 'manage_autopilot_tier') return autopilotTier(actor, { action: 'tier', tier: args.tier, ...(args.guardrails === undefined ? {} : { guardrails: args.guardrails }), confirmation: args.confirmation });
  return writingAgents(actor, name === 'list_writing_agents' ? { action: 'list', ...args } : args);
 },
}];
