import { feedsError } from './server/messages';
import { auditedReceipt, pageIdsFor, type McpToolGroup } from '@/server/mcp/kit';
import { checkFeed, createFeed, deleteFeed, readFeeds, updateFeed, type FeedDeps } from './server/feeds';
import type { FeedActor } from './server/access';
import { FEEDS_FEATURE_ID } from './manifest';
import { FEEDS_BOUNDS } from './config';
import { SLOTS_MAX, WORDPRESS_BOUNDS, WORDPRESS_DEFAULTS } from './wordpress/config';
import { previewRecipeSource, readRecipeSource, retryRecipeSlotsNow, runRecipePlannerNow, saveRecipeSource, setRecipeSourceState } from './server/wordpress';

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

const recipeConfigSchema = {
  type: 'object', additionalProperties: false, description: 'Overrides of the Root defaults; omitted fields keep the default.',
  properties: {
    mapping: { type: 'object', additionalProperties: false, properties: { captionMetaKey: { type: 'string' }, imageMetaKey: { type: 'string' }, recipeMetaKey: { type: 'string' }, skipMetaKey: { type: 'string' }, attachedFileMetaKey: { type: 'string' }, postType: { type: 'string' }, postStatus: { type: 'string' } } },
    order: { enum: ['newest', 'oldest'] }, maxAgeDays: { type: 'integer', minimum: WORDPRESS_BOUNDS.maxAgeDays.min, maximum: WORDPRESS_BOUNDS.maxAgeDays.max }, skipShared: { type: 'boolean' },
    slots: { type: 'array', items: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, minItems: 1, maxItems: SLOTS_MAX }, timezone: { type: 'string' },
    horizonDays: { type: 'integer', minimum: WORDPRESS_BOUNDS.horizonDays.min, maximum: WORDPRESS_BOUNDS.horizonDays.max }, distinctAcrossPages: { type: 'boolean' },
    cooldownDays: { type: 'integer', minimum: WORDPRESS_BOUNDS.repostCooldownDays.min, maximum: WORDPRESS_BOUNDS.repostCooldownDays.max },
    firstCommentTemplate: { type: 'string', maxLength: WORDPRESS_DEFAULTS.textMaxCharacters }, firstCommentDelayMinutes: { type: 'integer', minimum: WORDPRESS_BOUNDS.firstCommentDelayMinutes.min, maximum: WORDPRESS_BOUNDS.firstCommentDelayMinutes.max },
  },
} as const;
export const recipeToolDefinitions = [
  { name: 'get_recipe_source', description: 'Read the workspace WordPress recipe source: its channels, times, first-comment template, state, the planned-posts ledger and the recipe pool health (eligible recipes left per channel, estimated days until they run out, and whether that is below the warning threshold; null when the recipe library cannot be read). A member or key limited to some channels sees it only when all its channels are inside that access.', inputSchema: { type: 'object', properties: { page: { type: 'integer', minimum: 1, maximum: FEEDS_BOUNDS.pageNumberMax.max } }, additionalProperties: false } },
  { name: 'save_recipe_source', description: 'Create or replace the workspace recipe source. A new source starts paused unless enabled is true. Saving never publishes. Confirmation must exactly match SAVE RECIPE SOURCE <name>.', inputSchema: { type: 'object', required: ['name', 'siteUrl', 'allTargets', 'targetIds', 'confirmation'], properties: { name: { type: 'string', minLength: 1, maxLength: WORDPRESS_BOUNDS.sourceNameMaxCharacters.max }, siteUrl: { type: 'string', maxLength: FEEDS_BOUNDS.urlMaxCharacters.max }, enabled: { type: 'boolean' }, allTargets: { type: 'boolean', description: 'Plan for every selected channel Publishing accepts.' }, targetIds: { type: 'array', items: { type: 'string', maxLength: FEEDS_BOUNDS.identifierMaxCharacters.max }, maxItems: FEEDS_BOUNDS.maxTargets.max }, config: recipeConfigSchema, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'preview_recipe_source', description: 'Show the next recipes exactly as they will post (image address, caption and first comment). Creates nothing.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'run_recipe_planner', description: 'Fill the unplanned posting times now with scheduled posts, one different recipe per channel and time. Posts are created through Publishing and follow its approval rules. Confirmation must exactly match RUN RECIPE PLANNER.', inputSchema: { type: 'object', required: ['confirmation'], properties: { confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'set_recipe_source_state', description: 'Pause or resume automatic planning. Pausing keeps posts already scheduled. Confirmation must exactly match PAUSE RECIPE SOURCE or RESUME RECIPE SOURCE. With enabled false and cancelScheduled true (when Root allows it; see limits.pauseCancel in get_recipe_source) the source\'s scheduled, not yet published posts are also cancelled through Publishing and return to drafts; confirmation must then exactly match PAUSE RECIPE SOURCE AND CANCEL SCHEDULED POSTS. The result reports cancelled, notCancelled and remaining; repeat while remaining is true.', inputSchema: { type: 'object', required: ['enabled', 'confirmation'], properties: { enabled: { type: 'boolean' }, cancelScheduled: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'retry_recipe_slots', description: 'Plan again the upcoming posting times that failed or whose result was uncertain. A failed time never produced a post. An uncertain time is checked in Publishing first: when a post exists it is recorded and not duplicated; only a time confirmed to have no post is planned again; one that cannot be confirmed yet stays uncertain. Confirmation must exactly match RETRY RECIPE SLOTS.', inputSchema: { type: 'object', required: ['confirmation'], properties: { confirmation: { type: 'string' } }, additionalProperties: false } },
] as const;
export const recipeTools = new Set<string>(recipeToolDefinitions.map(tool => tool.name));
export const feedTools = new Set<string>([...feedToolDefinitions.map(tool => tool.name), ...recipeTools]);
export const feedWriteTools = new Set<string>(['create_content_feed', 'update_content_feed', 'delete_content_feed', 'check_content_feed', 'save_recipe_source', 'preview_recipe_source', 'run_recipe_planner', 'set_recipe_source_state', 'retry_recipe_slots']);

export async function executeFeedTool(actor: FeedActor, name: string, args: unknown, deps: FeedDeps = {}) {
  if (name === 'get_recipe_source') return readRecipeSource(actor, args ?? {});
  if (name === 'save_recipe_source') return saveRecipeSource(actor, args);
  if (name === 'preview_recipe_source') return previewRecipeSource(actor, args ?? {});
  if (name === 'run_recipe_planner') return runRecipePlannerNow(actor, args);
  if (name === 'set_recipe_source_state') return setRecipeSourceState(actor, args);
  if (name === 'retry_recipe_slots') return retryRecipeSlotsNow(actor, args);
  if (name === 'list_content_feeds') return readFeeds(actor, args ?? {});
  if (name === 'create_content_feed') return createFeed(actor, args, deps);
  if (name === 'update_content_feed') return updateFeed(actor, args, deps);
  if (name === 'delete_content_feed') return deleteFeed(actor, args);
  if (name === 'check_content_feed') return checkFeed(actor, args, deps);
  throw await feedsError('invalid_request', 'Choose a supported feed action.');
}

/**
 * MCP tool group of content feeds. Every tool honours a channel ceiling: the service shows and changes only
 * feeds whose channels are all inside the credential's current access (a feed naming no channel belongs to the
 * whole workspace and is refused to restricted credentials), and destination checks reuse Publishing's scope
 * rules. Writes need the exact confirmation, which the service re-checks; the service owns its workspace lock.
 */
export const FEEDS_MCP: readonly McpToolGroup[] = [{
  id: 'content-feeds',
  tools: [...feedToolDefinitions, ...recipeToolDefinitions],
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
    if (name === 'get_recipe_source' || name === 'preview_recipe_source') return result;
    if (name === 'save_recipe_source') { const saved = result as Awaited<ReturnType<typeof saveRecipeSource>>; return auditedReceipt(viewer, name, { sourceId: saved.id, created: saved.created }, saved); }
    if (name === 'set_recipe_source_state') { const state = result as Awaited<ReturnType<typeof setRecipeSourceState>>; return auditedReceipt(viewer, name, { sourceId: state.id, enabled: state.enabled, ...('cancellation' in state ? { cancelled: state.cancellation.cancelled, notCancelled: state.cancellation.notCancelled } : {}) }, state); }
    if (name === 'retry_recipe_slots') { const retry = result as Awaited<ReturnType<typeof retryRecipeSlotsNow>>; return auditedReceipt(viewer, name, { sourceId: retry.sourceId, reconciled: retry.reconciled, released: retry.released, planned: retry.planned, failed: retry.failed, uncertain: retry.uncertain }, retry); }
    if (name === 'run_recipe_planner') { const run = result as Awaited<ReturnType<typeof runRecipePlannerNow>>; return auditedReceipt(viewer, name, { sourceId: run.sourceId, planned: run.planned, failed: run.failed, uncertain: run.uncertain, unfilled: run.unfilled }, run); }
    const checked = result as Awaited<ReturnType<typeof checkFeed>>;
    // A preview changes nothing, so only a creating mode leaves an MCP audit receipt.
    return checked.draftsCreated || checked.postsCreated
      ? auditedReceipt(viewer, name, { feedId: checked.feedId, drafts: checked.draftsCreated, posts: checked.postsCreated, held: checked.held }, checked)
      : checked;
  },
}];
