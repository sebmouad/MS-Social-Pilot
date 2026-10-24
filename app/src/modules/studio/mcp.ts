import { OperationError } from '@/lib/operation-error';
import type { McpToolGroup } from '@/server/mcp/kit';
import { AGENTS_MCP } from './agents/mcp';
import { AI_CONTENT_TOOLS_MCP } from './content-tools/mcp';
import { CAPTION_TESTS_MCP } from './caption-tests/mcp';
import { AI_TRANSLATED_MCP } from './server/translated/mcp';
import { AI_KINDS, TONES } from './ai';
import { AI_BOUNDS } from './config';import { aiStatus, runAssist, COMPOSER_FEATURE, type AiDeps } from './server/ai';
import type { AiActor } from './server/access';
import { suggestAltText } from './server/alt-text';

export const aiToolDefinitions = [
  { name: 'get_ai_assist_status', description: 'Report whether AI writing assist is available to this member in the current workspace, with supported kinds, tones, input limit and the estimated AI usage this month against the workspace budget. Unavailable when it is not configured by the installation operator or is switched off for the workspace.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'ai_assist_write', description: 'Generate suggested post text (caption, improve, translate or hashtags). Returns text for review only: it saves, schedules and publishes nothing, so the member must use the text deliberately. Counted against the workspace hourly AI limit.', inputSchema: { type: 'object', required: ['kind', 'text'], properties: { kind: { enum: [...AI_KINDS] }, text: { type: 'string', minLength: 1, maxLength: AI_BOUNDS.maxInputCharacters.max }, tone: { enum: [...TONES] }, language: { type: 'string', maxLength: AI_BOUNDS.languageMaxCharacters.max, description: 'Required for translate, for example French.' } }, additionalProperties: false } },
  { name: 'suggest_image_alt_text', description: 'Suggest a description (alt text) for one stored image of this workspace, using the picture itself. Returns text for review only: it saves and publishes nothing. Counted against the workspace hourly AI limit and monthly budget. Unavailable when AI or image descriptions are off.', inputSchema: { type: 'object', required: ['imageId'], properties: { imageId: { type: 'string', description: 'Stored workspace image ID (the id after media: in a post image reference).' }, language: { type: 'string', maxLength: AI_BOUNDS.languageMaxCharacters.max, description: 'Language of the description, for example French. Defaults to the Root setting.' } }, additionalProperties: false } },
] as const;
export const aiTools = new Set<string>(aiToolDefinitions.map(tool => tool.name));
export const aiWriteTools = new Set<string>(['ai_assist_write', 'suggest_image_alt_text']);

export async function executeAiTool(actor: AiActor, name: string, args: unknown, deps: AiDeps = {}) {
  if (name === 'get_ai_assist_status') return aiStatus(actor, deps);
  if (name === 'ai_assist_write') return runAssist(actor, args, deps);
  if (name === 'suggest_image_alt_text') return suggestAltText(actor, args, deps);
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
    features: { get_ai_assist_status: COMPOSER_FEATURE, ai_assist_write: COMPOSER_FEATURE, suggest_image_alt_text: COMPOSER_FEATURE },
    writeTools: ['ai_assist_write', 'suggest_image_alt_text'],
    selfLockedWrites: ['ai_assist_write', 'suggest_image_alt_text'],
    scope: { resourceTools: ['get_ai_assist_status', 'ai_assist_write', 'suggest_image_alt_text'] },
    execute: (viewer, name, args) => executeAiTool({ userId: viewer.userId, workspaceId: viewer.workspaceId, ...(viewer.permissions ? { permissionCeiling: viewer.permissions } : {}) }, name, args),
  },
];

/**
 * Every MCP tool group Studio installs, in listing order. Tool names are unchanged by the
 * module move; only the owning module changed (writing assist, media generation and checks,
 * caption tests, writing agents, translated posts).
 */
export const STUDIO_MCP: readonly McpToolGroup[] = [
  ...AI_MCP,
  AI_CONTENT_TOOLS_MCP,
  ...CAPTION_TESTS_MCP,
  ...AGENTS_MCP,
  AI_TRANSLATED_MCP,
];
