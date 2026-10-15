import { prisma } from '../data';
import { enabledSocialAccountWhere } from '../platforms/registry';
import { canUseFeature, requireFeature, type Entitlements } from '../entitlements';
import { createLocalDraft, deleteLocalDraft, updateLocalDraft } from '../post-mutations';
import { setConnectionSelections } from '../connection-mutations';
import { randomBytes } from 'node:crypto';
import { canAccessFeature, canAccessPage, type ScopedPermissions } from '../permissions';
import { moderateInboxComment, replyToInbox, setInboxResolved } from '../inbox/actions';
import { cancelScheduledPost, createPost, deletePost, publishPost, reviewPost, schedulePost, submitPostForApproval, syncPostStatus, updatePost } from '../publishing/lifecycle';
import { readConfig, runtimeConfig, saveConfig } from '../config/store';
import { analyticsRange, loadAnalytics } from '../analytics/data';
import { buildAnalytics } from '../analytics/aggregate';
import { CONFIG_SCHEMA_VERSION, safeConfigShape } from '@/lib/config/registry';
import { deleteWorkspaceData, exportWorkspaceData, previewWorkspaceDataDeletion } from '../data-control';
import { assertWorkspaceNotPurging, withWorkspaceOperation } from '../data-control/guard';
import { campaignCreationConfirmation, canManageWorkspaceAds, createWorkspaceAdCampaign, createWorkspaceAdSet, readWorkspaceAdObject, updateWorkspaceAd } from '../ads/actions';
import type { AdMutationRequest } from '@/platforms/types';
import { getAdsAccountWhere, getAdsAccounts, getAdsDataset } from '../ads/queries';
import { platformAds } from '../platforms/registry';
import { summarizeInsights } from '../ads/summary';
import { deleteUnusedWorkspaceImage, getWorkspaceImageMetadata, listWorkspaceImages, uploadWorkspaceImage } from '../media/storage';

export type McpViewer = { userId: string; workspaceId: string; role: string; workspace: { id: string; name: string; timezone: string }; entitlements: Entitlements; permissions?: ScopedPermissions; maxResultItems?: number; apiKeyId?: string; isInstanceOwner?: boolean };
type JsonRpcId = string | number | null;

const versions = ['2025-06-18', '2025-03-26', '2024-11-05'];
const pageIdsFor = (viewer: McpViewer): string[] | undefined => viewer.permissions?.pageScope.all === false ? [...viewer.permissions.pageScope.ids] : undefined;
const textResult = (value: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  structuredContent: Array.isArray(value) ? { items: value } : value,
});

const tools = [
  { name: 'list_workspace_images', description: 'List bounded workspace image metadata. Image bytes remain in workspace storage and are not included.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 }, cursor: { type: 'string' } }, additionalProperties: false } },
  { name: 'get_workspace_image', description: 'Read metadata for one image stored in this workspace.', inputSchema: { type: 'object', required: ['imageId'], properties: { imageId: { type: 'string' } }, additionalProperties: false } },
  { name: 'delete_workspace_image', description: 'Permanently delete an unused workspace image. Images attached to posts cannot be deleted. Confirmation must exactly match DELETE WORKSPACE IMAGE <imageId>.', inputSchema: { type: 'object', required: ['imageId', 'confirmation'], properties: { imageId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'upload_workspace_image', description: 'Store a workspace image from standard base64 data. Root image MIME and byte limits apply. Confirmation must exactly match UPLOAD WORKSPACE IMAGE <fileName>.', inputSchema: { type: 'object', required: ['fileName', 'mimeType', 'base64', 'confirmation'], properties: { fileName: { type: 'string', minLength: 1, maxLength: 180 }, mimeType: { type: 'string' }, base64: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'list_pages', description: 'List enabled workspace destinations and their publishing availability.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_posts', description: 'List workspace posts, newest first. Filter by status and scheduled date.', inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'Comma-separated post statuses.' }, from: { type: 'string', description: 'ISO date or date-time lower bound for scheduledAt.' }, to: { type: 'string', description: 'ISO date or date-time upper bound for scheduledAt.' }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false } },
  { name: 'list_inbox', description: 'List synced comments and conversations visible in the workspace inbox.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['comment', 'message'] }, state: { type: 'string', enum: ['open', 'resolved', 'all'] }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: 'reply_to_inbox', description: 'Send a reply to a synced Facebook conversation or comment. This contacts Facebook. Confirmation must exactly match REPLY <message|comment> <id>.', inputSchema: { type: 'object', required: ['kind', 'id', 'text', 'confirmation'], properties: { kind: { type: 'string', enum: ['message', 'comment'] }, id: { type: 'string' }, text: { type: 'string', minLength: 1, maxLength: 2000 }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'set_inbox_resolved', description: 'Resolve or reopen a synced Facebook conversation or comment. Confirmation must exactly match RESOLVE <message|comment> <id> or REOPEN <message|comment> <id>.', inputSchema: { type: 'object', required: ['kind', 'id', 'resolved', 'confirmation'], properties: { kind: { type: 'string', enum: ['message', 'comment'] }, id: { type: 'string' }, resolved: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'moderate_inbox_comment', description: 'Hide or unhide a synced Facebook comment. This contacts Facebook. Confirmation must exactly match HIDE COMMENT <id> or UNHIDE COMMENT <id>.', inputSchema: { type: 'object', required: ['id', 'hidden', 'confirmation'], properties: { id: { type: 'string' }, hidden: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'get_page_analytics', description: 'Read stored daily insights for one workspace Page.', inputSchema: { type: 'object', required: ['pageId'], properties: { pageId: { type: 'string' }, days: { type: 'integer', minimum: 1, maximum: 365 } }, additionalProperties: false } },
  { name: 'get_analytics_overview', description: 'Read available metrics and combined audience for selected channels. Metrics, audience entries, and selected channels have independent offsets; each response is bounded.', inputSchema: { type: 'object', properties: { start: { type: 'string', description: 'Start date, YYYY-MM-DD.' }, end: { type: 'string', description: 'End date, YYYY-MM-DD.' }, targetIds: { type: 'array', items: { type: 'string' }, description: 'Selected channel IDs; omit to use every accessible channel.' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 }, audienceOffset: { type: 'integer', minimum: 0 }, targetOffset: { type: 'integer', minimum: 0 } }, additionalProperties: false } },
  { name: 'get_analytics_metric_details', description: 'Read a bounded page of stored date points or channel/breakdown rows for one Analytics metric. Continue with nextOffset until null.', inputSchema: { type: 'object', required: ['metricKey', 'kind'], properties: { start: { type: 'string', description: 'Start date, YYYY-MM-DD.' }, end: { type: 'string', description: 'End date, YYYY-MM-DD.' }, targetIds: { type: 'array', items: { type: 'string' }, description: 'Selected channel IDs; omit to use every accessible channel.' }, metricKey: { type: 'string', minLength: 1 }, kind: { type: 'string', enum: ['points', 'rows'] }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false } },
  { name: 'list_ad_accounts', description: 'List advertising accounts in this workspace using bounded offset pagination.', inputSchema: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false } },
  { name: 'get_ad_creation_options', description: 'Read safe Ads creation choices and exact confirmation formats for one enabled, connected advertising account. Only workspace owners and admins can use this tool.', inputSchema: { type: 'object', required: ['adAccountId'], properties: { adAccountId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' } }, additionalProperties: false } },
  { name: 'get_ads_performance', description: 'Read stored campaign, ad set, and ad performance for accessible ad accounts. Performance rows and account summaries have independent offsets.', inputSchema: { type: 'object', properties: { start: { type: 'string', description: 'Start date, YYYY-MM-DD.' }, end: { type: 'string', description: 'End date, YYYY-MM-DD.' }, accountId: { type: 'string', description: 'Accessible ad account ID.' }, level: { type: 'string', enum: ['campaign', 'adset', 'ad'] }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 }, accountOffset: { type: 'integer', minimum: 0 } }, additionalProperties: false } },
  { name: 'get_live_ad_status', description: 'Read live configured and effective status for a campaign, ad set, or ad verified in stored insights. Requires Ads read access and an enabled connected account visible to your page scope.', inputSchema: { type: 'object', required: ['adAccountId', 'objectId', 'objectType'], properties: { adAccountId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' }, objectId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' }, objectType: { type: 'string', enum: ['campaign', 'adset', 'ad'] } }, additionalProperties: false } },
  { name: 'create_ad_campaign', description: 'Create a paused campaign in the selected advertising account. Use the selected platform objective and exact confirmation format.', inputSchema: { type: 'object', required: ['adAccountId', 'name', 'objective', 'confirmation'], properties: { adAccountId: { type: 'string' }, name: { type: 'string' }, objective: { type: 'string', minLength: 1, maxLength: 100 }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'create_ad_set', description: 'Create a paused ad set under a campaign verified in the selected account. Requires all Pages in scope. Confirmation must exactly match the account platform format.', inputSchema: { type: 'object', required: ['adAccountId', 'campaignId', 'name', 'dailyBudgetMinor', 'countryCode', 'optimizationGoal', 'confirmation'], properties: { adAccountId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' }, campaignId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' }, name: { type: 'string', minLength: 1, maxLength: 100 }, dailyBudgetMinor: { type: 'integer', minimum: 1 }, countryCode: { type: 'string', pattern: '^[A-Z]{2}$' }, optimizationGoal: { type: 'string', minLength: 1, maxLength: 100 }, confirmation: { type: 'string', maxLength: 500 } }, additionalProperties: false } },
  { name: 'update_ad', description: 'Change the status or one budget of a verified ad campaign, ad set, or ad. Confirmation must exactly match SET AD STATUS <objectId> TO <ACTIVE|PAUSED> or SET AD BUDGET <objectId> TO <amount> MINOR UNITS.', inputSchema: { type: 'object', required: ['adAccountId', 'objectId', 'objectType', 'confirmation'], properties: { adAccountId: { type: 'string' }, objectId: { type: 'string' }, objectType: { type: 'string', enum: ['campaign', 'adset', 'ad'] }, status: { type: 'string', enum: ['active', 'paused'] }, dailyBudgetMinor: { type: 'integer', minimum: 1 }, lifetimeBudgetMinor: { type: 'integer', minimum: 1 }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'preview_workspace_data_deletion', description: 'Count workspace records that a data deletion would remove. Only workspace owners and admins may use this tool.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'export_workspace_data', description: 'Export the current workspace JSON snapshot, including directly workspace-owned legacy tables with credential fields redacted. Indirect records and media bytes are not included. Only workspace owners and admins may use this tool.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'delete_workspace_data', description: 'Delete workspace records and stored files while retaining workspace identity and members. A failed file cleanup can be retried. Confirmation must exactly match DELETE WORKSPACE DATA <workspaceId>. Only workspace owners and admins may use this tool.', inputSchema: { type: 'object', required: ['confirmation'], properties: { confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'create_draft', description: 'Create an unpublished local draft. Confirmation is required: confirmation must be exactly CREATE DRAFT.', inputSchema: { type: 'object', required: ['message', 'confirmation'], properties: { message: { type: 'string', minLength: 1, maxLength: 10000 }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'update_draft', description: 'Edit an unconnected local draft. Confirmation must be exactly UPDATE DRAFT followed by its ID.', inputSchema: { type: 'object', required: ['postId', 'message', 'confirmation'], properties: { postId: { type: 'string' }, message: { type: 'string', minLength: 1, maxLength: 10000 }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'delete_draft', description: 'Permanently delete an unconnected local draft. Confirmation must be exactly DELETE DRAFT followed by its ID.', inputSchema: { type: 'object', required: ['postId', 'confirmation'], properties: { postId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'publish_post', description: 'Publish a workspace post now to its configured destinations. This contacts social platforms. Confirmation must exactly match PUBLISH POST <postId>.', inputSchema: { type: 'object', required: ['postId', 'confirmation'], properties: { postId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'sync_post_status', description: 'Refresh a post status from supported social platforms. Confirmation must exactly match SYNC POST STATUS <postId>.', inputSchema: { type: 'object', required: ['postId', 'confirmation'], properties: { postId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'delete_post', description: 'Permanently delete a workspace post and its local publishing history. Set deleteRemote to true to also request deletion of remote posts. Confirmation must exactly match DELETE POST <postId> LOCAL or DELETE POST <postId> REMOTE.', inputSchema: { type: 'object', required: ['postId', 'deleteRemote', 'confirmation'], properties: { postId: { type: 'string' }, deleteRemote: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'create_post', description: 'Create a local post draft with selected destinations and optional first comment, link, or media URL. Confirmation must exactly match CREATE POST.', inputSchema: { type: 'object', required: ['message', 'targetIds', 'confirmation'], properties: { message: { type: 'string' }, firstComment: { type: 'string' }, link: { type: 'string' }, imageUrl: { type: 'string' }, videoUrl: { type: 'string' }, targetIds: { type: 'array', items: { type: 'string' } }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'update_post', description: 'Edit an unpublished post and its selected destinations. Confirmation must exactly match UPDATE POST <postId>.', inputSchema: { type: 'object', required: ['postId', 'message', 'targetIds', 'confirmation'], properties: { postId: { type: 'string' }, message: { type: 'string' }, firstComment: { type: 'string' }, link: { type: 'string' }, imageUrl: { type: 'string' }, videoUrl: { type: 'string' }, targetIds: { type: 'array', items: { type: 'string' } }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'submit_post_for_approval', description: 'Submit a draft for review. Confirmation must exactly match SUBMIT POST <postId>.', inputSchema: { type: 'object', required: ['postId', 'confirmation'], properties: { postId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'review_post', description: 'Approve or reject a pending post. Confirmation must exactly match APPROVE POST <postId> or REJECT POST <postId>.', inputSchema: { type: 'object', required: ['postId', 'decision', 'confirmation'], properties: { postId: { type: 'string' }, decision: { type: 'string', enum: ['approve', 'reject'] }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'schedule_post', description: 'Schedule a draft for a future ISO timestamp. Confirmation must exactly match SCHEDULE POST <postId> <timestamp>.', inputSchema: { type: 'object', required: ['postId', 'scheduledAt', 'confirmation'], properties: { postId: { type: 'string' }, scheduledAt: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'cancel_scheduled_post', description: 'Return a queued post to drafts before delivery. Confirmation must exactly match CANCEL SCHEDULE <postId>.', inputSchema: { type: 'object', required: ['postId', 'confirmation'], properties: { postId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'set_connection_selection', description: 'Enable or disable one workspace channel or advertising account. Confirmation must exactly identify the selection and action.', inputSchema: { type: 'object', required: ['kind', 'id', 'enabled', 'confirmation'], properties: { kind: { type: 'string', enum: ['target', 'adAccount'] }, id: { type: 'string' }, enabled: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'get_root_config', description: 'Read installation configuration definitions and safe values. Only available to the signed-in instance owner; secrets are masked.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'set_root_config', description: 'Validate and save an installation setting. Only available to the signed-in instance owner. Confirmation must exactly match SET ROOT CONFIG <key> or CLEAR ROOT SECRET <key>.', inputSchema: { type: 'object', required: ['key', 'confirmation'], properties: { key: { type: 'string' }, value: {}, clear: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
];
const rootTools = new Set(['get_root_config', 'set_root_config']);
const canUseRootTool = (viewer: McpViewer) => viewer.isInstanceOwner === true && !viewer.apiKeyId;
const dataTools = new Set(['preview_workspace_data_deletion', 'export_workspace_data', 'delete_workspace_data']);
const adsManagerTools = new Set(['list_ad_accounts', 'get_ad_creation_options', 'create_ad_campaign', 'create_ad_set', 'update_ad']);
const canManageData = (viewer: McpViewer) => viewer.role === 'owner' || viewer.role === 'admin';
const dataResource = (uri: string) => uri === 'msp://data/deletion-preview';

const toolFeatures: Record<string, string> = {
  list_workspace_images: 'publishing/media',
  get_workspace_image: 'publishing/media',
  delete_workspace_image: 'publishing/media',
  upload_workspace_image: 'publishing/media',
  list_pages: 'settings/connections',
  list_posts: 'publishing/posts',
  list_inbox: 'inbox/conversations',
  reply_to_inbox: 'inbox/conversations',
  set_inbox_resolved: 'inbox/conversations',
  moderate_inbox_comment: 'inbox/conversations',
  get_page_analytics: 'analytics/overview',
  get_analytics_overview: 'analytics/overview',
  get_analytics_metric_details: 'analytics/overview',
  get_ads_performance: 'ads/campaigns',
  get_live_ad_status: 'ads/campaigns',
  list_ad_accounts: 'ads/campaigns',
  get_ad_creation_options: 'ads/campaigns',
  create_ad_campaign: 'ads/campaigns',
  create_ad_set: 'ads/campaigns',
  update_ad: 'ads/campaigns',
  preview_workspace_data_deletion: 'settings/data',
  export_workspace_data: 'settings/data',
  delete_workspace_data: 'settings/data',
  create_draft: 'publishing/posts',
  update_draft: 'publishing/posts',
  delete_draft: 'publishing/posts',
  publish_post: 'publishing/posts',
  sync_post_status: 'publishing/posts',
  delete_post: 'publishing/posts',
  create_post: 'publishing/posts',
  update_post: 'publishing/posts',
  submit_post_for_approval: 'publishing/posts',
  review_post: 'publishing/approvals',
  schedule_post: 'publishing/posts',
  cancel_scheduled_post: 'publishing/posts',
  set_connection_selection: 'settings/connections',
};

const writeTools = new Set(['create_draft', 'update_draft', 'delete_draft', 'publish_post', 'sync_post_status', 'delete_post', 'delete_workspace_data', 'create_post', 'update_post', 'submit_post_for_approval', 'review_post', 'schedule_post', 'cancel_scheduled_post', 'set_connection_selection', 'reply_to_inbox', 'set_inbox_resolved', 'moderate_inbox_comment', 'create_ad_campaign', 'create_ad_set', 'update_ad', 'set_root_config', 'delete_workspace_image', 'upload_workspace_image']);

async function auditWrite(viewer: McpViewer, tool: string, detail: Record<string, unknown>) {
  await prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`mcp_${randomBytes(12).toString('hex')}`}, ${viewer.userId}, 'mcp.write', ${JSON.stringify({ workspaceId: viewer.workspaceId, ...(viewer.apiKeyId ? { apiKeyId: viewer.apiKeyId } : {}), tool, ...detail })}::jsonb, NOW())`;
}

async function auditConfirmedAdsWrite(viewer: McpViewer, tool: string, detail: Record<string, unknown>) {
  try {
    await auditWrite(viewer, tool, detail);
    return true;
  } catch {
    console.error('MCP Ads creation succeeded but its audit record could not be saved.', { workspaceId: viewer.workspaceId, actorId: viewer.userId, tool, ...detail });
    return false;
  }
}

function confirmedAdsReceipt(result: Record<string, unknown>, mcpAuditRecorded: boolean) {
  const auditRecorded = result.auditRecorded !== false;
  return {
    ...result,
    confirmedSuccess: true,
    auditRecorded,
    mcpAuditRecorded,
    ...(!auditRecorded || !mcpAuditRecorded ? {
      warning: 'Creation succeeded and the object is paused, but one or more audit records could not be saved. Do not submit this creation again.',
    } : {}),
  };
}

function requireConfirmation(args: Record<string, unknown>, expected: string) {
  if (args.confirmation !== expected) throw new Error(`Confirmation required. Repeat the call with confirmation exactly: ${expected}`);
}

function requiredString(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required.`);
  return value.trim();
}

async function loadScopedAnalytics(viewer: McpViewer, args: Record<string, unknown>) {
  const date = (key: 'start' | 'end') => {
    const value = args[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00`).getTime())) throw new Error(`${key} must be a valid YYYY-MM-DD date.`);
    return value;
  };
  const start = date('start');
  const end = date('end');
  if (start && end && start > end) throw new Error('start must not be after end.');
  const range = analyticsRange(start, end);
  const maxRangeDays = Number(await runtimeConfig('analytics.maxRangeDays'));
  if ((range.to.getTime() - range.from.getTime()) / 86_400_000 > maxRangeDays) throw new Error(`Date range exceeds the configured ${maxRangeDays}-day maximum.`);
  const allowedTargetIds = pageIdsFor(viewer);
  const available = await loadAnalytics(viewer.workspaceId, [], range, allowedTargetIds);
  const availableIds = new Set(available.targets.map(target => target.id));
  const cap = viewer.maxResultItems ?? 100;
  if (args.targetIds !== undefined && (!Array.isArray(args.targetIds) || args.targetIds.length > cap || args.targetIds.some(id => typeof id !== 'string' || !availableIds.has(id)))) throw new Error('One or more selected channels are unavailable or exceed the configured result limit.');
  const selectedIds = args.targetIds === undefined ? available.targets.map(target => target.id) : [...new Set(args.targetIds as string[])];
  const data = await loadAnalytics(viewer.workspaceId, selectedIds, range, allowedTargetIds);
  const overview = buildAnalytics(data.metrics, data.audienceEntries, data.audienceSelected);
  return { range, data, overview };
}

async function runTool(viewer: McpViewer, name: string, args: Record<string, unknown>) {
  if (rootTools.has(name) && !canUseRootTool(viewer)) throw new Error('Root configuration is unavailable.');
  if (dataTools.has(name) && !canManageData(viewer)) throw new Error('Only workspace owners and admins can manage workspace data.');
  if (adsManagerTools.has(name) && !canManageData(viewer)) throw new Error('Only workspace owners and admins can manage ads.');
  const feature = toolFeatures[name];
  if (feature) requireFeature(viewer.entitlements, feature);
  if (feature && (!viewer.permissions || !canAccessFeature(viewer.permissions, feature, writeTools.has(name) ? 'write' : 'read'))) throw new Error('You do not have permission to use this feature.');
  if (writeTools.has(name) && name !== 'delete_workspace_data' && name !== 'set_root_config') {
    await assertWorkspaceNotPurging(viewer.workspaceId);
  }
  const cap = viewer.maxResultItems ?? 100;
  switch (name) {
    case 'list_workspace_images': {
      const limit = Math.max(1, Math.min(cap, 200, Math.trunc(Number(args.limit) || cap)));
      const cursor = args.cursor === undefined ? undefined : requiredString(args, 'cursor');
      return listWorkspaceImages(viewer.workspaceId, { limit, cursor });
    }
    case 'get_workspace_image':
      return getWorkspaceImageMetadata(viewer.workspaceId, requiredString(args, 'imageId'));
    case 'delete_workspace_image': {
      const imageId = requiredString(args, 'imageId');
      requireConfirmation(args, `DELETE WORKSPACE IMAGE ${imageId}`);
      const outcome = await deleteUnusedWorkspaceImage(viewer.workspaceId, imageId);
      if (outcome === 'in_use') throw new Error('This image is attached to a post and cannot be deleted.');
      if (outcome === 'missing') throw new Error('Image not found in this workspace.');
      await auditWrite(viewer, name, { imageId });
      return { imageId, deleted: true };
    }
    case 'upload_workspace_image': {
      const fileName = requiredString(args, 'fileName');
      const mimeType = requiredString(args, 'mimeType');
      const encoded = requiredString(args, 'base64');
      if (fileName.length > 180) throw new Error('fileName must contain at most 180 characters.');
      requireConfirmation(args, `UPLOAD WORKSPACE IMAGE ${fileName}`);
      const maxBytes = Number(await runtimeConfig('publishing.maxImageUploadBytes'));
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || encoded.length > Math.ceil(maxBytes / 3) * 4) throw new Error('Image exceeds the configured upload size limit.');
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('base64 must contain standard padded base64 data.');
      const bytes = Buffer.from(encoded, 'base64');
      if (!bytes.length || bytes.length > maxBytes || bytes.toString('base64') !== encoded) throw new Error('Image exceeds the configured upload size limit or has invalid base64 data.');
      const image = await uploadWorkspaceImage({ userId: viewer.userId, workspaceId: viewer.workspaceId }, new File([bytes], fileName, { type: mimeType }));
      await auditWrite(viewer, name, { imageId: image.id, mimeType: image.mimeType, size: bytes.length });
      return { ...image, size: bytes.length, reference: `media:${image.id}`, url: `/api/media/${image.id}` };
    }
    case 'get_root_config':
      return { schemaVersion: CONFIG_SCHEMA_VERSION, definitions: safeConfigShape(), values: await readConfig() };
    case 'set_root_config': {
      const key = requiredString(args, 'key');
      const clear = args.clear === true;
      requireConfirmation(args, `${clear ? 'CLEAR ROOT SECRET' : 'SET ROOT CONFIG'} ${key}`);
      await saveConfig({ key, value: args.value, clear }, viewer.userId);
      await auditWrite(viewer, name, { key, clear });
      return { key, saved: true, schemaVersion: CONFIG_SCHEMA_VERSION };
    }
    case 'list_pages':
      const pageIds = pageIdsFor(viewer);
      return prisma.target.findMany({ where: { workspaceId: viewer.workspaceId, enabled: true, socialAccount: { is: await enabledSocialAccountWhere() }, ...(pageIds ? { id: { in: pageIds } } : {}) }, orderBy: [{ type: 'asc' }, { name: 'asc' }], take: cap, select: { id: true, type: true, providerId: true, name: true, pictureUrl: true, canPublish: true } });
    case 'list_posts': {
      const status = typeof args.status === 'string' ? args.status.split(',').map(s => s.trim()).filter(Boolean) : [];
      const allowedStatuses = new Set(['draft', 'pending_approval', 'rejected', 'scheduled', 'publishing', 'published', 'partially_failed', 'failed', 'cancelled']);
      if (status.some(value => !allowedStatuses.has(value))) throw new Error('status contains an unsupported post status.');
      const from = typeof args.from === 'string' ? new Date(args.from) : undefined;
      const to = typeof args.to === 'string' ? new Date(args.to) : undefined;
      if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw new Error('from and to must be valid ISO dates.');
      const limit = Math.max(1, Math.min(cap, Math.trunc(Number(args.limit) || cap)));
      const pageIds = pageIdsFor(viewer);
      return prisma.post.findMany({ where: { workspaceId: viewer.workspaceId, ...(pageIds ? { OR: [{ targets: { some: {}, none: { targetId: { notIn: pageIds } } } }, { authorId: viewer.userId, targets: { none: {} } }] } : {}), ...(status.length ? { status: { in: status as never[] } } : {}), ...(from || to ? { scheduledAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) }, orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }], take: limit, select: { id: true, message: true, firstComment: true, link: true, media: true, status: true, scheduledAt: true, publishedAt: true, createdAt: true, targets: { where: pageIds ? { targetId: { in: pageIds } } : {}, select: { status: true, remotePostId: true, remoteUrl: true, target: { select: { id: true, type: true, name: true } } } } } });
    }
    case 'list_inbox': {
      const kind = args.kind === 'comment' || args.kind === 'message' ? args.kind : undefined;
      const state = args.state === 'resolved' || args.state === 'all' ? args.state : 'open';
      const limit = Math.max(1, Math.min(cap, Math.trunc(Number(args.limit) || Math.min(50, cap))));
      const pageIds = pageIdsFor(viewer);
      const conversationWhere = { target: { workspaceId: viewer.workspaceId, ...(pageIds ? { id: { in: pageIds } } : {}) }, ...(state === 'all' ? {} : { resolvedAt: state === 'resolved' ? { not: null } : null }) };
      const commentWhere = { isHidden: false, postTarget: { post: { workspaceId: viewer.workspaceId }, target: { workspaceId: viewer.workspaceId, ...(pageIds ? { id: { in: pageIds } } : {}) } }, ...(state === 'all' ? {} : { resolvedAt: state === 'resolved' ? { not: null } : null }) };
      const [conversations, comments] = await Promise.all([
        kind === 'comment' ? Promise.resolve([]) : prisma.conversation.findMany({ where: conversationWhere, orderBy: { updatedTime: 'desc' }, take: limit, select: { id: true, snippet: true, unreadCount: true, updatedTime: true, resolvedAt: true, target: { select: { id: true, type: true, name: true } }, messages: { orderBy: { createdTime: 'desc' }, take: 5, select: { id: true, fromName: true, message: true, createdTime: true } } } }),
        kind === 'message' ? Promise.resolve([]) : prisma.postComment.findMany({ where: commentWhere, orderBy: { createdTime: 'desc' }, take: limit, select: { id: true, message: true, fromName: true, createdTime: true, resolvedAt: true, replyCount: true, postTarget: { select: { target: { select: { id: true, type: true, name: true } }, post: { select: { id: true, message: true } } } } } }),
      ]);
      return { conversations, comments };
    }
    case 'reply_to_inbox': {
      const kind = args.kind === 'message' || args.kind === 'comment' ? args.kind : null;
      const id = typeof args.id === 'string' ? args.id : '';
      if (!kind || !id) throw new Error('kind and id are required.');
      requireConfirmation(args, `REPLY ${kind} ${id}`);
      const text = typeof args.text === 'string' ? args.text.trim() : '';
      const result = await replyToInbox(viewer, { kind, id, text });
      await auditWrite(viewer, name, { kind, itemId: id });
      return { ...result, kind, itemId: id };
    }
    case 'set_inbox_resolved': {
      const kind = args.kind === 'message' || args.kind === 'comment' ? args.kind : null;
      const id = typeof args.id === 'string' ? args.id : '';
      if (!kind || !id || typeof args.resolved !== 'boolean') throw new Error('kind, id, and resolved are required.');
      const verb = args.resolved ? 'RESOLVE' : 'REOPEN';
      requireConfirmation(args, `${verb} ${kind} ${id}`);
      const result = await setInboxResolved(viewer, { kind, id, resolved: args.resolved });
      await auditWrite(viewer, name, { kind, itemId: id, resolved: args.resolved });
      return { ...result, kind, itemId: id, resolved: args.resolved };
    }
    case 'moderate_inbox_comment': {
      const id = typeof args.id === 'string' ? args.id : '';
      if (!id || typeof args.hidden !== 'boolean') throw new Error('id and hidden are required.');
      requireConfirmation(args, `${args.hidden ? 'HIDE' : 'UNHIDE'} COMMENT ${id}`);
      const result = await moderateInboxComment(viewer, { id, hidden: args.hidden });
      await auditWrite(viewer, name, { itemId: id, hidden: args.hidden });
      return { ...result, itemId: id, hidden: args.hidden };
    }
    case 'get_page_analytics': {
      const pageId = String(args.pageId ?? '');
      const pageIds = pageIdsFor(viewer);
      const page = await prisma.target.findFirst({ where: { id: pageId, workspaceId: viewer.workspaceId, type: 'page', ...(pageIds ? { id: { in: pageIds } } : {}) }, select: { id: true, name: true } });
      if (!page) throw new Error('Page not found in this workspace.');
      const days = Math.max(1, Math.min(365, Math.trunc(Number(args.days) || 30)));
      const rows = await prisma.pageInsight.findMany({ where: { targetId: pageId, period: 'day', endTime: { gte: new Date(Date.now() - days * 86_400_000) } }, orderBy: { endTime: 'desc' }, take: cap, select: { metric: true, period: true, endTime: true, numeric: true, value: true } });
      return { page, days, insights: rows };
    }
    case 'get_analytics_overview': {
      const { range, data, overview } = await loadScopedAnalytics(viewer, args);
      const offset = args.offset === undefined ? 0 : Number(args.offset);
      const audienceOffset = args.audienceOffset === undefined ? 0 : Number(args.audienceOffset);
      const targetOffset = args.targetOffset === undefined ? 0 : Number(args.targetOffset);
      const limit = args.limit === undefined ? Math.min(cap, 50) : Number(args.limit);
      if (![offset, audienceOffset, targetOffset].every(value => Number.isInteger(value) && value >= 0) || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('offsets and limit must be valid integers.');
      const pageLimit = Math.min(limit, cap);
      const metrics = overview.metrics.slice(offset, offset + pageLimit);
      const boundedMetrics = metrics.map(metric => ({
        ...metric,
        points: metric.points.slice(0, cap),
        rows: metric.rows.slice(0, cap),
        pointsTruncated: metric.points.length > cap,
        rowsTruncated: metric.rows.length > cap,
      }));
      const audienceEntries = overview.audience.entries.slice(audienceOffset, audienceOffset + pageLimit);
      const selectedTargets = data.selectedTargets.slice(targetOffset, targetOffset + pageLimit).map(target => ({ id: target.id, type: target.type, name: target.name }));
      return { range, selectedTargets, selectedTargetCount: data.selectedTargets.length, nextTargetOffset: targetOffset + selectedTargets.length < data.selectedTargets.length ? targetOffset + selectedTargets.length : null, audience: { ...overview.audience, entries: audienceEntries, entryCount: overview.audience.entries.length, entriesTruncated: audienceOffset + audienceEntries.length < overview.audience.entries.length, nextOffset: audienceOffset + audienceEntries.length < overview.audience.entries.length ? audienceOffset + audienceEntries.length : null }, adAccountCount: data.adAccountCount, metricCount: overview.metrics.length, metrics: boundedMetrics, nextOffset: offset + metrics.length < overview.metrics.length ? offset + metrics.length : null };
    }
    case 'get_analytics_metric_details': {
      const metricKey = requiredString(args, 'metricKey');
      const kind = args.kind;
      if (kind !== 'points' && kind !== 'rows') throw new Error('kind must be points or rows.');
      const { range, overview } = await loadScopedAnalytics(viewer, args);
      const metric = overview.metrics.find(candidate => candidate.key === metricKey);
      if (!metric) throw new Error('Metric is unavailable for this selection and date range.');
      const offset = args.offset === undefined ? 0 : Number(args.offset);
      const limit = args.limit === undefined ? Math.min(cap, 50) : Number(args.limit);
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('offset and limit must be valid integers.');
      const pageLimit = Math.min(limit, cap);
      const details = metric[kind];
      const items = details.slice(offset, offset + pageLimit);
      return { range, metric: { key: metric.key, label: metric.label, sourceLabel: metric.sourceLabel, unit: metric.unit, kind: metric.kind }, detailKind: kind, totalCount: details.length, offset, items, nextOffset: offset + items.length < details.length ? offset + items.length : null };
    }
    case 'list_ad_accounts': {
      if (viewer.role !== 'owner' && viewer.role !== 'admin') throw new Error('Only workspace owners and admins can list advertising accounts.');
      const offset = args.offset === undefined ? 0 : Number(args.offset);
      const limit = args.limit === undefined ? cap : Number(args.limit);
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('offset and limit must be valid integers.');
      const pageLimit = Math.min(limit, cap);
      const where = await getAdsAccountWhere(viewer.workspaceId, pageIdsFor(viewer));
      const [accounts, accountCount] = await Promise.all([
        prisma.adAccount.findMany({ where, orderBy: { name: 'asc' }, skip: offset, take: pageLimit, select: { id: true, actId: true, name: true, enabled: true, currency: true } }),
        prisma.adAccount.count({ where }),
      ]);
      return { accounts, accountCount, nextOffset: offset + accounts.length < accountCount ? offset + accounts.length : null };
    }
    case 'get_ads_performance': {
      const date = (key: 'start' | 'end') => {
        const value = args[key];
        if (value === undefined) return undefined;
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${key} must be a valid YYYY-MM-DD date.`);
        const parsed = new Date(`${value}T00:00:00.000Z`);
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${key} must be a valid YYYY-MM-DD date.`);
        return value;
      };
      const start = date('start');
      const end = date('end');
      if (start && end && start > end) throw new Error('start must not be after end.');
      const range = analyticsRange(start, end);
      const maxRangeDays = Number(await runtimeConfig('analytics.maxRangeDays'));
      if ((range.to.getTime() - range.from.getTime()) / 86_400_000 > maxRangeDays) throw new Error(`Date range exceeds the configured ${maxRangeDays}-day maximum.`);
      const allowedTargetIds = pageIdsFor(viewer);
      const accounts = await getAdsAccounts(viewer.workspaceId, allowedTargetIds);
      if (args.accountId !== undefined && (typeof args.accountId !== 'string' || !accounts.some(account => account.id === args.accountId))) throw new Error('Ad account is unavailable in this workspace.');
      const accountId = args.accountId as string | undefined;
      const filters = { period: 'custom' as const, since: range.from, until: range.to, accountId: accountId ?? null };
      const { insights } = await getAdsDataset(viewer.workspaceId, filters, allowedTargetIds);
      const level = args.level;
      if (level !== undefined && !['campaign', 'adset', 'ad'].includes(String(level))) throw new Error('level must be campaign, adset, or ad.');
      const rows = summarizeInsights(insights, level as string | undefined).filter(row => ['campaign', 'adset', 'ad'].includes(row.level));
      const offset = args.offset === undefined ? 0 : Number(args.offset);
      const limit = args.limit === undefined ? Math.min(cap, 50) : Number(args.limit);
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('offset and limit must be valid integers.');
      const pageLimit = Math.min(limit, cap);
      const accountOffset = args.accountOffset === undefined ? 0 : Number(args.accountOffset);
      if (!Number.isInteger(accountOffset) || accountOffset < 0) throw new Error('accountOffset must be a non-negative integer.');
      const performance = rows.slice(offset, offset + pageLimit).map(row => ({
        id: row.id, name: row.name, level: row.level, accountId: row.accountId, accountName: row.accountName, currency: row.currency,
        spend: row.spend, impressions: row.impressions, clicks: row.clicks, reach: row.reach, reachDate: row.reachDate,
        cpc: row.cpc, cpm: row.cpm, cpp: row.cpp, ctr: row.ctr, frequency: row.frequency, actions: row.actions, dailyRowCount: row.rows,
      }));
      const visibleAccounts = accounts.filter(account => !accountId || account.id === accountId);
      const accountPage = visibleAccounts.slice(accountOffset, accountOffset + cap).map(({ id, name, currency }) => ({ id, name, currency }));
      return { range, accounts: accountPage, accountCount: visibleAccounts.length, nextAccountOffset: accountOffset + accountPage.length < visibleAccounts.length ? accountOffset + accountPage.length : null, level: level ?? null, resultCount: rows.length, performance, nextOffset: offset + performance.length < rows.length ? offset + performance.length : null };
    }
    case 'get_live_ad_status': {
      const adAccountId = requiredString(args, 'adAccountId');
      const objectId = requiredString(args, 'objectId');
      const objectType = requiredString(args, 'objectType') as 'campaign' | 'adset' | 'ad';
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(adAccountId) || !/^[A-Za-z0-9_-]{1,100}$/.test(objectId) || !['campaign', 'adset', 'ad'].includes(objectType)) throw new Error('Invalid ad object request.');
      return readWorkspaceAdObject({ userId: viewer.userId, workspaceId: viewer.workspaceId }, { adAccountId, objectId, objectType }, pageIdsFor(viewer));
    }
    case 'get_ad_creation_options': {
      const adAccountId = requiredString(args, 'adAccountId');
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(adAccountId)) throw new Error('Invalid ad account ID.');
      const where = await getAdsAccountWhere(viewer.workspaceId, pageIdsFor(viewer));
      const account = await prisma.adAccount.findFirst({
        where: { ...where, id: adAccountId },
        select: { id: true, currency: true, socialAccount: { select: { provider: true } } },
      });
      const provider = account?.socialAccount?.provider;
      const host = provider ? await platformAds(provider) : null;
      const manageable = account && await canManageWorkspaceAds({ userId: viewer.userId, workspaceId: viewer.workspaceId }, adAccountId);
      if (!account || !provider || !host || !manageable) throw new Error('The selected advertising account is unavailable.');
      return {
        adAccountId: account.id,
        provider,
        currency: account.currency,
        campaign: host.ui.campaign ? { options: host.ui.campaign.options, defaultOption: host.ui.campaign.defaultOption, confirmationTemplate: host.ui.campaign.confirmationTemplate } : null,
        adSet: viewer.permissions?.pageScope.all === true && host.ui.adSet ? { options: host.ui.adSet.options, defaultOption: host.ui.adSet.defaultOption, confirmationTemplate: host.ui.adSet.confirmationTemplate, countryCodeFormat: 'Two uppercase letters, for example MA', dailyBudgetFormat: 'Positive integer in minor currency units' } : null,
      };
    }
    case 'create_ad_campaign': {
      const adAccountId = requiredString(args, 'adAccountId');
      const nameValue = requiredString(args, 'name');
      const objective = requiredString(args, 'objective');
      const confirmation = requiredString(args, 'confirmation');
      requireConfirmation(args, await campaignCreationConfirmation(viewer.workspaceId, adAccountId, nameValue, objective));
      const result = await createWorkspaceAdCampaign(viewer, { adAccountId, name: nameValue, objective, confirmation });
      const mcpAuditRecorded = await auditConfirmedAdsWrite(viewer, name, { adAccountId, campaignId: result.campaignId });
      return confirmedAdsReceipt(result, mcpAuditRecorded);
    }
    case 'create_ad_set': {
      const adAccountId = requiredString(args, 'adAccountId');
      const campaignId = requiredString(args, 'campaignId');
      const nameValue = requiredString(args, 'name');
      const dailyBudgetMinor = args.dailyBudgetMinor;
      const countryCode = requiredString(args, 'countryCode');
      const optimizationGoal = requiredString(args, 'optimizationGoal');
      const confirmation = requiredString(args, 'confirmation');
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(adAccountId) || !/^[A-Za-z0-9_-]{1,100}$/.test(campaignId) || typeof dailyBudgetMinor !== 'number' || !Number.isSafeInteger(dailyBudgetMinor) || dailyBudgetMinor < 1 || !/^[A-Z]{2}$/.test(countryCode)) throw new Error('Invalid ad set request.');
      if (viewer.permissions?.pageScope.all !== true) throw new Error('Ad set creation is unavailable for limited page access.');
      const where = await getAdsAccountWhere(viewer.workspaceId, pageIdsFor(viewer));
      const account = await prisma.adAccount.findFirst({
        where: { ...where, id: adAccountId },
        select: { socialAccount: { select: { provider: true } } },
      });
      const host = account?.socialAccount ? await platformAds(account.socialAccount.provider) : null;
      if (!host) throw new Error('The selected advertising account is unavailable.');
      requireConfirmation(args, host.adSetConfirmation({ adAccountId, campaignId, name: nameValue.trim(), dailyBudgetMinor, countryCode, optimizationGoal }));
      const result = await createWorkspaceAdSet(viewer, { adAccountId, campaignId, name: nameValue, dailyBudgetMinor, countryCode, optimizationGoal, confirmation }, true);
      const mcpAuditRecorded = await auditConfirmedAdsWrite(viewer, name, { adAccountId, campaignId, adSetId: result.adSetId });
      return confirmedAdsReceipt(result, mcpAuditRecorded);
    }
    case 'update_ad': {
      const adAccountId = requiredString(args, 'adAccountId');
      const objectId = requiredString(args, 'objectId');
      const objectType = requiredString(args, 'objectType') as AdMutationRequest['objectType'];
      const status = args.status === undefined ? undefined : requiredString(args, 'status') as AdMutationRequest['status'];
      const dailyBudgetMinor = args.dailyBudgetMinor === undefined ? undefined : Number(args.dailyBudgetMinor);
      const lifetimeBudgetMinor = args.lifetimeBudgetMinor === undefined ? undefined : Number(args.lifetimeBudgetMinor);
      const confirmation = requiredString(args, 'confirmation');
      const budget = dailyBudgetMinor ?? lifetimeBudgetMinor;
      if (budget !== undefined) requireConfirmation(args, `SET AD BUDGET ${objectId} TO ${budget} MINOR UNITS`);
      else if (status === 'active' || status === 'paused') requireConfirmation(args, `SET AD STATUS ${objectId} TO ${status.toUpperCase()}`);
      await updateWorkspaceAd(viewer, { adAccountId, objectId, objectType, status, dailyBudgetMinor, lifetimeBudgetMinor, confirmation });
      await auditWrite(viewer, name, { adAccountId, objectId, objectType });
      return { adAccountId, objectId, updated: true };
    }
    case 'preview_workspace_data_deletion':
      return previewWorkspaceDataDeletion({ userId: viewer.userId, workspaceId: viewer.workspaceId });
    case 'export_workspace_data':
      return exportWorkspaceData({ userId: viewer.userId, workspaceId: viewer.workspaceId });
    case 'delete_workspace_data': {
      requireConfirmation(args, `DELETE WORKSPACE DATA ${viewer.workspaceId}`);
      const counts = await deleteWorkspaceData({ userId: viewer.userId, workspaceId: viewer.workspaceId, ...(viewer.apiKeyId ? { apiKeyId: viewer.apiKeyId } : {}) }, 'DELETE');
      return { deleted: true, counts };
    }
    case 'create_draft': {
      requireFeature(viewer.entitlements, 'publishing/posts');
      requireConfirmation(args, 'CREATE DRAFT');
      const message = typeof args.message === 'string' ? args.message.trim() : '';
      if (!message || message.length > 10000) throw new Error('message must contain 1 to 10000 characters.');
      const result = await createLocalDraft(viewer, message);
      await auditWrite(viewer, name, { postId: result.id });
      return { id: result.id, status: 'draft' };
    }
    case 'update_draft': {
      requireFeature(viewer.entitlements, 'publishing/posts');
      const postId = String(args.postId ?? '');
      requireConfirmation(args, `UPDATE DRAFT ${postId}`);
      const message = typeof args.message === 'string' ? args.message.trim() : '';
      if (!postId || !message || message.length > 10000) throw new Error('postId and a message of 1 to 10000 characters are required.');
      await updateLocalDraft(viewer, postId, message);
      await auditWrite(viewer, name, { postId });
      return { id: postId, status: 'draft', updated: true };
    }
    case 'delete_draft': {
      requireFeature(viewer.entitlements, 'publishing/posts');
      const postId = String(args.postId ?? '');
      requireConfirmation(args, `DELETE DRAFT ${postId}`);
      if (!postId) throw new Error('postId is required.');
      await deleteLocalDraft(viewer, postId);
      await auditWrite(viewer, name, { postId });
      return { id: postId, deleted: true };
    }
    case 'publish_post': {
      const postId = typeof args.postId === 'string' ? args.postId : '';
      if (!postId) throw new Error('postId is required.');
      requireConfirmation(args, `PUBLISH POST ${postId}`);
      const result = await publishPost(viewer, postId);
      await auditWrite(viewer, name, { postId, ...result });
      return { postId, ...result };
    }
    case 'sync_post_status': {
      const postId = typeof args.postId === 'string' ? args.postId : '';
      if (!postId) throw new Error('postId is required.');
      requireConfirmation(args, `SYNC POST STATUS ${postId}`);
      const result = await syncPostStatus(viewer, postId);
      await auditWrite(viewer, name, { postId, ...result });
      return { postId, ...result };
    }
    case 'delete_post': {
      const postId = typeof args.postId === 'string' ? args.postId : '';
      if (!postId || typeof args.deleteRemote !== 'boolean') throw new Error('postId and deleteRemote are required.');
      requireConfirmation(args, `DELETE POST ${postId} ${args.deleteRemote ? 'REMOTE' : 'LOCAL'}`);
      await deletePost(viewer, postId, args.deleteRemote);
      await auditWrite(viewer, name, { postId, remoteDeletionRequested: args.deleteRemote });
      return { postId, deleted: true, remoteDeletionRequested: args.deleteRemote };
    }
    case 'create_post': {
      requireConfirmation(args, 'CREATE POST');
      if (!Array.isArray(args.targetIds) || args.targetIds.some(id => typeof id !== 'string')) throw new Error('targetIds must be an array of destination IDs.');
      const media = [
        ...(typeof args.imageUrl === 'string' && args.imageUrl.trim() ? [{ kind: 'image' as const, url: args.imageUrl.trim() }] : []),
        ...(typeof args.videoUrl === 'string' && args.videoUrl.trim() ? [{ kind: 'video' as const, url: args.videoUrl.trim() }] : []),
      ];
      const result = await createPost(viewer, { message: requiredString(args, 'message'), firstComment: typeof args.firstComment === 'string' ? args.firstComment : '', targetIds: args.targetIds, link: typeof args.link === 'string' ? args.link : undefined, media });
      await auditWrite(viewer, name, { postId: result.id, targetCount: args.targetIds.length });
      return { id: result.id, status: 'draft' };
    }
    case 'update_post': {
      const postId = requiredString(args, 'postId');
      requireConfirmation(args, `UPDATE POST ${postId}`);
      if (!Array.isArray(args.targetIds) || args.targetIds.some(id => typeof id !== 'string')) throw new Error('targetIds must be an array of destination IDs.');
      const media = [
        ...(typeof args.imageUrl === 'string' && args.imageUrl.trim() ? [{ kind: 'image' as const, url: args.imageUrl.trim() }] : []),
        ...(typeof args.videoUrl === 'string' && args.videoUrl.trim() ? [{ kind: 'video' as const, url: args.videoUrl.trim() }] : []),
      ];
      await updatePost(viewer, { postId, message: requiredString(args, 'message'), firstComment: typeof args.firstComment === 'string' ? args.firstComment : '', targetIds: args.targetIds, link: typeof args.link === 'string' ? args.link : undefined, media });
      await auditWrite(viewer, name, { postId, targetCount: args.targetIds.length });
      return { postId, updated: true };
    }
    case 'submit_post_for_approval': {
      const postId = requiredString(args, 'postId');
      requireConfirmation(args, `SUBMIT POST ${postId}`);
      await submitPostForApproval(viewer, postId);
      await auditWrite(viewer, name, { postId });
      return { postId, status: 'pending_approval' };
    }
    case 'review_post': {
      const postId = requiredString(args, 'postId');
      if (args.decision !== 'approve' && args.decision !== 'reject') throw new Error('decision must be approve or reject.');
      requireConfirmation(args, `${args.decision.toUpperCase()} POST ${postId}`);
      await reviewPost(viewer, postId, args.decision);
      await auditWrite(viewer, name, { postId, decision: args.decision });
      return { postId, decision: args.decision };
    }
    case 'schedule_post': {
      const postId = requiredString(args, 'postId');
      const scheduledAt = requiredString(args, 'scheduledAt');
      const date = new Date(scheduledAt);
      if (!Number.isFinite(date.getTime()) || !/^\d{4}-\d\d-\d\dT/.test(scheduledAt)) throw new Error('scheduledAt must be an ISO date-time.');
      requireConfirmation(args, `SCHEDULE POST ${postId} ${scheduledAt}`);
      await schedulePost(viewer, postId, date);
      await auditWrite(viewer, name, { postId, scheduledAt: date.toISOString() });
      return { postId, status: 'scheduled', scheduledAt: date.toISOString() };
    }
    case 'cancel_scheduled_post': {
      const postId = requiredString(args, 'postId');
      requireConfirmation(args, `CANCEL SCHEDULE ${postId}`);
      await cancelScheduledPost(viewer, postId);
      await auditWrite(viewer, name, { postId });
      return { postId, status: 'draft' };
    }
    case 'set_connection_selection': {
      requireFeature(viewer.entitlements, 'settings/connections');
      const kind = args.kind === 'target' || args.kind === 'adAccount' ? args.kind : null;
      const id = typeof args.id === 'string' ? args.id : '';
      const enabled = args.enabled === true;
      if (!kind || !id || typeof args.enabled !== 'boolean') throw new Error('kind, id, and enabled are required.');
      const action = enabled ? 'ENABLED' : 'DISABLED';
      requireConfirmation(args, `SET CONNECTION ${kind} ${id} ${action}`);
      await setConnectionSelections(viewer, [{ kind, id, enabled }]);
      await auditWrite(viewer, name, { kind, id, enabled });
      return { kind, id, enabled };
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

export async function handleMcpMessage(viewer: McpViewer, message: Record<string, unknown>) {
  const id = (message.id ?? null) as JsonRpcId;
  const method = message.method;
  const params = (message.params && typeof message.params === 'object' ? message.params : {}) as Record<string, unknown>;
  const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id, result });
  const error = (code: number, text: string) => Response.json({ jsonrpc: '2.0', id, error: { code, message: text } });
  if (message.jsonrpc !== '2.0' || typeof method !== 'string') return error(-32600, 'Invalid request.');
  if (message.id === undefined && method !== 'initialize') return new Response(null, { status: 202 });
  if (method === 'ping') return reply({});
  if (method === 'initialize') {
    const requested = String(params.protocolVersion ?? '');
    return reply({ protocolVersion: versions.includes(requested) ? requested : versions[0], capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } }, serverInfo: { name: 'ms-social-pilot', version: '0.1.0' }, instructions: `Workspace-scoped access for ${viewer.workspace.name}. Writes can manage local posts, publish posts, sync provider status, change channel/ad account selections, or manage Facebook Inbox items. Publishing, remote post deletion, Inbox replies, and comment moderation contact social platforms. Every write requires an explicit confirmation string. Times use ${viewer.workspace.timezone}.` });
  }
  if (method === 'tools/list') return reply({ tools: tools.filter(tool => rootTools.has(tool.name) ? canUseRootTool(viewer) : canUseFeature(viewer.entitlements, toolFeatures[tool.name]!) && Boolean(viewer.permissions && canAccessFeature(viewer.permissions, toolFeatures[tool.name]!, writeTools.has(tool.name) ? 'write' : 'read')) && (tool.name !== 'set_connection_selection' || viewer.role === 'owner' || viewer.role === 'admin') && (!adsManagerTools.has(tool.name) || canManageData(viewer)) && (!dataTools.has(tool.name) || canManageData(viewer))) });
  if (method === 'tools/call') {
    const name = String(params.name ?? '');
    if (!tools.some(tool => tool.name === name)) return error(-32602, `Unknown tool: ${name}`);
    try {
      if (rootTools.has(name) && !canUseRootTool(viewer)) throw new Error('Root configuration is unavailable.');
      if (name === 'set_connection_selection' && viewer.role !== 'owner' && viewer.role !== 'admin') throw new Error('Only workspace owners and admins can change connections.');
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const result = (writeTools.has(name) && name !== 'delete_workspace_data' && name !== 'set_root_config') || name === 'get_live_ad_status'
        ? await withWorkspaceOperation(viewer.workspaceId, () => runTool(viewer, name, args))
        : await runTool(viewer, name, args);
      return reply(textResult(result));
    }
    catch (e) { return reply({ ...textResult({ error: e instanceof Error ? e.message : 'Tool failed.' }), isError: true }); }
  }
  if (method === 'resources/list') return reply({ resources: [
    { uri: 'msp://workspace', name: 'Workspace', description: 'Current workspace details.', mimeType: 'application/json' },
    { uri: 'msp://targets', name: 'Destinations', description: 'Enabled workspace destinations.', mimeType: 'application/json' },
    { uri: 'msp://posts', name: 'Posts', description: 'Recent workspace posts.', mimeType: 'application/json' },
    { uri: 'msp://media/images', name: 'Workspace images', description: 'Bounded workspace image metadata; image bytes are excluded.', mimeType: 'application/json' },
    { uri: 'msp://inbox', name: 'Inbox', description: 'Recent synced inbox activity.', mimeType: 'application/json' },
    { uri: 'msp://analytics/overview', name: 'Analytics overview', description: 'Selected-channel audience totals and available stored metrics for the default date range.', mimeType: 'application/json' },
    { uri: 'msp://ads/performance', name: 'Ads performance', description: 'Stored campaign, ad set, and ad performance for the default date range.', mimeType: 'application/json' },
    { uri: 'msp://data/deletion-preview', name: 'Data deletion preview', description: 'Current workspace record counts before deletion.', mimeType: 'application/json' },
    ...(canUseRootTool(viewer) ? [{ uri: 'msp://root/config', name: 'Root configuration', description: 'Installation setting definitions and safe values.', mimeType: 'application/json' }] : []),
  ].filter(resource => {
    const feature = resource.uri === 'msp://targets' ? 'settings/connections' : resource.uri === 'msp://posts' ? 'publishing/posts' : resource.uri === 'msp://media/images' ? 'publishing/media' : resource.uri === 'msp://inbox' ? 'inbox/conversations' : resource.uri === 'msp://analytics/overview' ? 'analytics/overview' : resource.uri === 'msp://ads/performance' ? 'ads/campaigns' : resource.uri === 'msp://data/deletion-preview' ? 'settings/data' : null;
    return (!dataResource(resource.uri) || canManageData(viewer)) && (feature === null || (canUseFeature(viewer.entitlements, feature) && Boolean(viewer.permissions && canAccessFeature(viewer.permissions, feature, 'read'))));
  }) });
  if (method === 'resources/read') {
    const uri = String(params.uri ?? '');
    if (dataResource(uri) && (!canManageData(viewer) || !canUseFeature(viewer.entitlements, 'settings/data') || !viewer.permissions || !canAccessFeature(viewer.permissions, 'settings/data', 'read'))) return error(-32602, 'Resource unavailable.');
    let contents: unknown;
    if (uri === 'msp://workspace') contents = viewer.workspace;
    else if (uri === 'msp://targets') contents = await runTool(viewer, 'list_pages', {});
    else if (uri === 'msp://posts') contents = await runTool(viewer, 'list_posts', { limit: 100 });
    else if (uri === 'msp://media/images') contents = await runTool(viewer, 'list_workspace_images', { limit: 100 });
    else if (uri === 'msp://inbox') contents = await runTool(viewer, 'list_inbox', { limit: 50 });
    else if (uri === 'msp://analytics/overview') contents = await runTool(viewer, 'get_analytics_overview', {});
    else if (uri === 'msp://ads/performance') contents = await runTool(viewer, 'get_ads_performance', {});
    else if (uri === 'msp://data/deletion-preview') contents = await runTool(viewer, 'preview_workspace_data_deletion', {});
    else if (uri === 'msp://root/config') contents = await runTool(viewer, 'get_root_config', {});
    else return error(-32602, `Unknown resource: ${uri}`);
    return reply({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(contents, null, 2) }] });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return new Response(null, { status: 202 });
  return error(-32601, `Method not found: ${String(method)}`);
}
