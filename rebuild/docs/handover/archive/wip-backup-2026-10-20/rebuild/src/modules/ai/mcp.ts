import { OperationError } from '@/lib/operation-error';
import { AI_KINDS, TONES } from './ai';
import { aiStatus, runAssist, type AiDeps } from './server/ai';
import type { ToolActor } from '@/modules/media/server/access';

export const aiToolDefinitions = [
  { name: 'get_ai_assist_status', description: 'Report whether AI writing assist is available to this member in the current workspace, with supported kinds, tones and input limit. Unavailable when not configured by the installation operator.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'ai_assist_write', description: 'Generate suggested post text (caption, improve, translate or hashtags). Returns text for review; saves and publishes nothing. Counted against the workspace hourly limit.', inputSchema: { type: 'object', required: ['kind', 'text'], properties: { kind: { enum: [...AI_KINDS] }, text: { type: 'string', minLength: 1, maxLength: 20000 }, tone: { enum: [...TONES] }, language: { type: 'string', maxLength: 32 } }, additionalProperties: false } },
] as const;
export const aiTools = new Set<string>(aiToolDefinitions.map(tool => tool.name));
export const aiWriteTools = new Set<string>(['ai_assist_write']);

export async function executeAiTool(actor: ToolActor, name: string, args: unknown, deps: AiDeps = {}) {
  if (name === 'get_ai_assist_status') return aiStatus(actor, deps);
  if (name === 'ai_assist_write') return runAssist(actor, args, deps);
  throw new OperationError('invalid_request', 'Choose a supported AI action.');
}
