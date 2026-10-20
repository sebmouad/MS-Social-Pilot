import { OperationError } from '@/lib/operation-error';
import { auditedReceipt, pageIdsFor, type McpToolGroup } from '@/server/mcp/kit';
import { checkFeed, createFeed, deleteFeed, readFeeds, updateFeed, type FeedDeps } from './server/feeds';
import type { FeedActor } from './server/access';
import { FEEDS_FEATURE_ID } from './manifest';
import { FEEDS_BOUNDS } from './config';

const fields = {
  name: { type: 'string', minLength: 1, maxLength: FEEDS_BOUNDS.nameMaxCharacters.max }, url: { type: 'string', maxLength: FEEDS_BOUNDS.urlMaxCharacters.max }, kind: { enum: ['rss', 'wordpress'] }, enabled: { type: 'boolean' },
  messageTemplate: { type: 'string', maxLength: FEEDS_BOUNDS.messageMaxCharacters.max }, hashtags: { type: 'string', maxLength: FEEDS_BOUNDS.hashtagsMaxCharacters.max }, targetIds: { type: 'array', items: { type: 'string', maxLength: FEEDS_BOUNDS.identifierMaxCharacters.max }, maxItems: FEEDS_BOUNDS.maxTargets.max },
  handling: { enum: ['review', 'schedule'], description: 'What automatic reading does with new items: review sends them to Approvals; schedule queues them (held for approval when the workspace requires it).' },
  spreadMinutes: { type: 'integer', minimum: 0, maximum: FEEDS_BOUNDS.maxSpreadMinutes.max, description: 'Minutes between channels; 0 posts to every channel at one time.' },
  confirmation: { type: 'string' },
};
export const feedToolDefinitions = [
  { name: 'list_content_feeds', description: 'List RSS, Atom or WordPress content feeds that turn new articles into posts. A member or key limited to some channels sees only feeds whose channels are all within that access.', inputSchema: { type: 'object', properties: { page: { type: 'integer', minimum: 1, maximum: FEEDS_BOUNDS.pageNumberMax.max } }, additionalProperties: false } },
  { name: 'create_content_feed', description: 'Save a content feed. Only public https addresses are accepted. Saving never publishes. Confirmation must exactly match CREATE FEED <name>.', inputSchema: { type: 'object', required: ['name', 'url', 'confirmation'], properties: fields, additionalProperties: false } },
  { name: 'update_content_feed', description: 'Replace one feed settings. Confirmation must exactly match UPDATE FEED <id>.', inputSchema: { type: 'object', required: ['id', 'name', 'url', 'confirmation'], properties: { id: { type: 'string', maxLength: FEEDS_BOUNDS.identifierMaxCharacters.max }, ...fields }, additionalProperties: false } },
  { name: 'delete_content_feed', description: 'Delete one feed and its remembered items. Posts already created stay in Publishing. Confirmation must exactly match DELETE FEED <id>.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id: { type: 'string', maxLength: FEEDS_BOUNDS.identifierMaxCharacters.max }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'check_content_feed', description: 'Read a feed now. mode preview (default) only reports new items and needs no confirmation. mode drafts creates one local draft per new item (confirmation CREATE FEED DRAFTS <id>). mode posts queues new items as the feed is set up, held for approval when the feed or workspace requires review (confirmation CREATE FEED POSTS <id>). Nothing is published immediately.', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: FEEDS_BOUNDS.identifierMaxCharacters.max }, mode: { enum: ['preview', 'drafts', 'posts'] }, confirmation: { type: 'string' } }, additionalProperties: false } },
] as const;
export const feedTools = new Set<string>(feedToolDefinitions.map(tool => tool.name));
export const feedWriteTools = new Set<string>(['create_content_feed', 'update_content_feed', 'delete_content_feed', 'check_content_feed']);

export async function executeFeedTool(actor: FeedActor, name: string, args: unknown, deps: FeedDeps = {}) {
  if (name === 'list_content_feeds') return readFeeds(actor, args ?? {});
  if (name === 'create_content_feed') return createFeed(actor, args, deps);
  if (name === 'update_content_feed') return updateFeed(actor, args, deps);
  if (name === 'delete_content_feed') return deleteFeed(actor, args);
  if (name === 'check_content_feed') return checkFeed(actor, args, deps);
  throw new OperationError('invalid_request', 'Choose a supported feed action.');
}

/**
 * MCP tool group of content feeds. Every tool honours a channel ceiling: the service shows and changes only
 * feeds whose channels are all inside the credential's current access (a feed naming no channel belongs to the
 * whole workspace and is refused to restricted credentials), and destination checks reuse Publishing's scope
 * rules. Writes need the exact confirmation, which the service re-checks; the service owns its workspace lock.
 */
export const FEEDS_MCP: readonly McpToolGroup[] = [{
  id: 'content-feeds',
  tools: feedToolDefinitions,
  features: Object.fromEntries([...feedTools].map(name => [name, FEEDS_FEATURE_ID])),
  writeTools: [...feedWriteTools],
  selfLockedWrites: [...feedWriteTools],
  scope: { resourceTools: [...feedTools], resources: ['msp://feeds/sources'] },
  resources: [
    { uri: 'msp://feeds/sources', name: 'Content feeds', description: 'First page of the workspace content feeds with their handling, channels and last result. Continue pages with list_content_feeds.', mimeType: 'application/json', feature: FEEDS_FEATURE_ID, readTool: 'list_content_feeds' },
  ],
  execute: async (viewer, name, args, cap) => {
    const ceiling = pageIdsFor(viewer);
    const actor: FeedActor = { userId: viewer.userId, workspaceId: viewer.workspaceId, ...(ceiling ? { allowedTargetIds: ceiling } : {}) };
    const result = await executeFeedTool(actor, name, args);
    if (name === 'list_content_feeds') {
      const page = result as Awaited<ReturnType<typeof readFeeds>>;
      const limit = Math.max(1, cap);
      return page.feeds.length > limit ? { ...page, feeds: page.feeds.slice(0, limit), hasMore: true, truncatedByCredential: true } : page;
    }
    if (name === 'create_content_feed' || name === 'update_content_feed') {
      const saved = result as Awaited<ReturnType<typeof createFeed>>;
      return auditedReceipt(viewer, name, { feedId: saved.id, handling: saved.handling }, saved);
    }
    if (name === 'delete_content_feed') {
      const removed = result as Awaited<ReturnType<typeof deleteFeed>>;
      return auditedReceipt(viewer, name, { feedId: removed.id }, removed);
    }
    const checked = result as Awaited<ReturnType<typeof checkFeed>>;
    // A preview changes nothing, so only a creating mode leaves an MCP audit receipt.
    return checked.draftsCreated || checked.postsCreated
      ? auditedReceipt(viewer, name, { feedId: checked.feedId, drafts: checked.draftsCreated, posts: checked.postsCreated, held: checked.held }, checked)
      : checked;
  },
}];
