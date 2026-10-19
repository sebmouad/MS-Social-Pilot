import { OperationError } from '@/lib/operation-error';
import type { McpToolGroup } from '@/server/mcp/kit';
import { AI_KINDS, TONES } from './ai';
import { aiStatus, runAssist, COMPOSER_FEATURE, type AiDeps } from './server/ai';
import type { AiActor } from './server/access';

export const aiToolDefinitions = [
  { name: 'get_ai_assist_status', description: 'Report whether AI writing assist is available to this member in the current workspace, with supported kinds, tones and input limit. Unavailable when it is not configured by the installation operator or is switched off for the workspace.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'ai_assist_write', description: 'Generate suggested post text (caption, improve, translate or hashtags). Returns text for review only: it saves, schedules and publishes nothing, so the member must use the text deliberately. Counted against the workspace hourly AI limit.', inputSchema: { type: 'object', required: ['kind', 'text'], properties: { kind: { enum: [...AI_KINDS] }, text: { type: 'string', minLength: 1, maxLength: 20000 }, tone: { enum: [...TONES] }, language: { type: 'string', maxLength: 32, description: 'Required for translate, for example French.' } }, additionalProperties: false } },
] as const;
export const aiTools = new Set<string>(aiToolDefinitions.map(tool => tool.name));
export const aiWriteTools = new Set<string>(['ai_assist_write']);

export async function executeAiTool(actor: AiActor, name: string, args: unknown, deps: AiDeps = {}) {
  if (name === 'get_ai_assist_status') return aiStatus(actor, deps);
  if (name === 'ai_assist_write') return runAssist(actor, args, deps);
  throw new OperationError('invalid_request', 'Choose a supported AI action.');
}

/**
 * MCP tool group this module installs. Both tools touch no channel or ad-account data (they only
 * transform text the caller supplies), so they are classified resource-safe; the key's permission
 * ceiling is still passed to the service, which intersects it with the member's current grants.
 * ai_assist_write needs write access to Posts: it spends the workspace's AI allowance.
 */
export const AI_MCP: readonly McpToolGroup[] = [
  {
    id: 'ai',
    tools: aiToolDefinitions,
    features: { get_ai_assist_status: COMPOSER_FEATURE, ai_assist_write: COMPOSER_FEATURE },
    writeTools: ['ai_assist_write'],
    selfLockedWrites: ['ai_assist_write'],
    scope: { resourceTools: ['get_ai_assist_status', 'ai_assist_write'] },
    execute: (viewer, name, args) => executeAiTool({ userId: viewer.userId, workspaceId: viewer.workspaceId, ...(viewer.permissions ? { permissionCeiling: viewer.permissions } : {}) }, name, args),
  },
];
