import { OperationError } from '@/lib/operation-error';
import { checkFeed, createFeed, deleteFeed, readFeeds, updateFeed, type FeedDeps } from './server/feeds';
import type { ToolActor } from '@/modules/media/server/access';

const fields = {
  name: { type: 'string', minLength: 1, maxLength: 240 }, url: { type: 'string', maxLength: 2048 }, kind: { enum: ['rss', 'wordpress'] }, enabled: { type: 'boolean' },
  messageTemplate: { type: 'string', maxLength: 20000 }, hashtags: { type: 'string', maxLength: 1000 }, targetIds: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 500 }, confirmation: { type: 'string' },
};
export const feedToolDefinitions = [
  { name: 'list_content_feeds', description: 'List RSS, Atom or WordPress content feeds that create post drafts. A member limited to some channels sees only feeds whose channels are all within their access.', inputSchema: { type: 'object', properties: { page: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'create_content_feed', description: 'Save a content feed. Only public https addresses are accepted. Never publishes. Confirmation must exactly match CREATE FEED <name>.', inputSchema: { type: 'object', required: ['name', 'url', 'confirmation'], properties: fields, additionalProperties: false } },
  { name: 'update_content_feed', description: 'Replace one feed settings. Confirmation must exactly match UPDATE FEED <id>.', inputSchema: { type: 'object', required: ['id', 'name', 'url', 'confirmation'], properties: { id: { type: 'string', maxLength: 80 }, ...fields }, additionalProperties: false } },
  { name: 'delete_content_feed', description: 'Delete one feed and its remembered items. Drafts already created stay in Publishing. Confirmation must exactly match DELETE FEED <id>.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id: { type: 'string', maxLength: 80 }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'check_content_feed', description: 'Read a feed now and report new items. With createDrafts true it creates one local draft per new item (never schedules or publishes); confirmation must exactly match CREATE FEED DRAFTS <id>. Without createDrafts, omit confirmation.', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 80 }, createDrafts: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
] as const;
export const feedTools = new Set<string>(feedToolDefinitions.map(tool => tool.name));
export const feedWriteTools = new Set<string>(['create_content_feed', 'update_content_feed', 'delete_content_feed', 'check_content_feed']);

export async function executeFeedTool(actor: ToolActor, name: string, args: unknown, deps: FeedDeps = {}) {
  if (name === 'list_content_feeds') return readFeeds(actor, args ?? {});
  if (name === 'create_content_feed') return createFeed(actor, args, deps);
  if (name === 'update_content_feed') return updateFeed(actor, args, deps);
  if (name === 'delete_content_feed') return deleteFeed(actor, args);
  if (name === 'check_content_feed') return checkFeed(actor, args, deps);
  throw new OperationError('invalid_request', 'Choose a supported feed action.');
}
