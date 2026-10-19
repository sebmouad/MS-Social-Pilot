import { OperationError } from '@/lib/operation-error';
import { runBulkPostAction } from './server/bulk';
import { BULK_ACTIONS, BULK_BOUNDS } from './bulk';
import type { PublishingActor } from './server/types';

export const bulkToolDefinitions = [
  { name: 'bulk_post_action', description: `Apply one action to up to ${BULK_BOUNDS.maxPosts} posts, each checked like the single action. delete is local-only (published copies stay on platforms). duplicate creates drafts (replaying the same requestId does not create more). reschedule moves still-waiting posts to date+time in the workspace time zone. retry re-sends only destinations that clearly failed; uncertain or submitted destinations are never re-sent and contact platforms only for failed ones. Returns per-post outcomes. Confirmation must exactly match <ACTION> <count> POSTS, e.g. RETRY 3 POSTS.`, inputSchema: { type: 'object', required: ['action', 'postIds', 'requestId', 'confirmation'], properties: { action: { type: 'string', enum: [...BULK_ACTIONS] }, postIds: { type: 'array', minItems: 1, maxItems: BULK_BOUNDS.maxPosts, items: { type: 'string' } }, requestId: { type: 'string', format: 'uuid' }, confirmation: { type: 'string' }, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, time: { type: 'string', pattern: '^\\d{2}:\\d{2}$' } }, additionalProperties: false } },
] as const;
export const bulkTools = new Set<string>(['bulk_post_action']);
export const bulkWriteTools = new Set<string>(['bulk_post_action']);

export async function executeBulkTool(actor: PublishingActor, name: string, args: unknown) {
  if (name === 'bulk_post_action') return runBulkPostAction(actor, args);
  throw new OperationError('invalid_request', 'Choose a supported bulk action.');
}
