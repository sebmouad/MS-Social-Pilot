import { OperationError } from '@/lib/operation-error';
import { auditedReceipt, publishingActor, type McpToolGroup } from '@/server/mcp/kit';
import type { McpViewer } from '@/server/mcp/types';
import { COMPOSER_FEATURE } from '../ai';
import type { ToolViewerActor } from '../tool-kit';
import { TRANSLATED_CONFIRMATION, translatedPosts } from './service';

const ids = { type: 'array', minItems: 1, maxItems: 500, items: { type: 'string', minLength: 1 } };
export const translatedToolDefinitions = [
  { name: 'suggest_post_translations', description: 'Suggest a translation of a post for each requested language, with the channels each will go to. Review only: nothing is saved, scheduled or posted. Counts toward the workspace hourly AI limit and monthly budget.', inputSchema: { type: 'object', required: ['message', 'translations'], properties: { message: { type: 'string', minLength: 1 }, translations: { type: 'array', minItems: 1, items: { type: 'object', required: ['language', 'targetIds'], properties: { language: { type: 'string', minLength: 2 }, targetIds: ids }, additionalProperties: false } } }, additionalProperties: false } },
  { name: 'create_translated_posts', description: `Create one post per language through the normal Publishing rules: the original text on the channels no translation claims and each translation on its own channels. Shared options (link, media, first comment, schedule) apply to every post. Exact confirmation: ${TRANSLATED_CONFIRMATION}.`, inputSchema: { type: 'object', required: ['message', 'targetIds', 'translations', 'confirmation'], properties: { message: { type: 'string' }, targetIds: ids, translations: { type: 'array', minItems: 1, items: { type: 'object', required: ['targetIds', 'message'], properties: { targetIds: ids, message: { type: 'string' } }, additionalProperties: false } }, options: { type: 'object' }, confirmation: { type: 'string' } }, additionalProperties: false } },
] as const;

const actorOf = (viewer: McpViewer): ToolViewerActor => ({ ...publishingActor(viewer), ...(viewer.permissions ? { permissionCeiling: viewer.permissions } : {}) } as ToolViewerActor);

export async function executeTranslatedTool(viewer: McpViewer, name: string, args: Record<string, unknown>) {
  if (name === 'suggest_post_translations') return translatedPosts(actorOf(viewer), { action: 'suggest', ...args });
  if (name === 'create_translated_posts') {
    const result = await translatedPosts(actorOf(viewer), { action: 'create', ...args }) as { created?: Array<{ postId: string }> };
    return auditedReceipt(viewer, name, { postIds: (result.created ?? []).map(post => post.postId) }, result as Record<string, unknown>);
  }
  throw new OperationError('invalid_request', 'Choose a supported translation action.');
}

/** Suggestions spend the AI allowance and creation targets channels, so both are resource tools whose service intersects the key's channel grants. */
export const AI_TRANSLATED_MCP: McpToolGroup = {
  id: 'ai-translated-posts',
  tools: translatedToolDefinitions,
  features: { suggest_post_translations: COMPOSER_FEATURE, create_translated_posts: COMPOSER_FEATURE },
  writeTools: ['suggest_post_translations', 'create_translated_posts'],
  selfLockedWrites: ['suggest_post_translations', 'create_translated_posts'],
  scope: { resourceTools: ['suggest_post_translations', 'create_translated_posts'] },
  execute: (viewer, name, args) => executeTranslatedTool(viewer, name, args),
};
