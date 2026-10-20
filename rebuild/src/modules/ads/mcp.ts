import { readAdsCreationOptions } from './server/creation-options';
import { listAdsAccounts, readAdsPerformance } from './server/performance';
import { OperationError } from '@/lib/operation-error';
import { entitledPlatformIds } from '@/server/entitlements';
import { ensureAdsManagement } from '@/modules/ads/server/management';
import { withAdsErrorBoundary } from '@/modules/ads/server/errors';
import { createWorkspaceAdCampaign, createWorkspaceAdSet, readWorkspaceAdObject, updateWorkspaceAd } from '@/modules/ads/server/actions';
import type { AdMutationRequest } from '@/platforms/types';
import { adsActorFor, adsTargetIdsFor, adAccountIdsFor, auditedReceipt, auditConfirmedAdsWrite, confirmedAdsReceipt, requiredString, type McpToolGroup } from '@/server/mcp/kit';
import { readAdsDailyRows } from './server/report-read';
import { exportAdsReport } from './server/export';
import { adsAnalysisToolDefinitions, executeAdsAnalysisTool } from './analysis/mcp';
import { adsManagementToolDefinitions, executeAdsManagementTool } from './management/mcp';
import { adsDirectoryToolDefinitions, executeAdsDirectoryTool } from './directory/mcp';
import { adsReportToolDefinitions, ADS_MCP_MAX_PAGE_ITEMS } from './mcp-metadata';

const ADS_MANAGER_TOOLS: ReadonlySet<string> = new Set(['list_ad_accounts', 'get_ad_creation_options', 'create_ad_campaign', 'create_ad_set', 'update_ad']);
/** Provider failures on campaign tools map to safe Ads errors. */
const adsErrorBoundary = { applies: () => true, wrap: withAdsErrorBoundary };

/** MCP tool groups this module installs. The host merges installed groups; edit only here. */
export const ADS_MCP: readonly McpToolGroup[] = [
  {
    id: 'ads-campaigns',
    tools: [...adsReportToolDefinitions, ...[
    { name: 'list_ad_accounts', description: 'List advertising accounts in this workspace using bounded offset pagination.', inputSchema: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false } },
    { name: 'get_ad_creation_options', description: 'Read safe Ads creation choices and exact confirmation formats for one enabled, connected advertising account. Only workspace owners and admins can use this tool.', inputSchema: { type: 'object', required: ['adAccountId'], properties: { adAccountId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' } }, additionalProperties: false } },
    { name: 'get_ads_performance', description: 'Read stored campaign, ad set, and ad performance for accessible ad accounts. reportOptions lists current date presets and bounds. Defaults use the Ads report policy. Date inputs are inclusive UTC calendar days; range.to is exclusive. Without period, a start-only request ends today, and an end-only request uses the default preset duration. Performance rows and account summaries have independent offsets.', inputSchema: { type: 'object', properties: { period: { type: 'string', description: 'A current preset ID from reportOptions, or custom with both start and end. Do not combine presets and explicit dates.' }, start: { type: 'string', description: 'Inclusive UTC start date, YYYY-MM-DD.' }, end: { type: 'string', description: 'Inclusive UTC end date, YYYY-MM-DD.' }, accountId: { type: 'string', description: 'Accessible ad account ID.' }, level: { type: 'string', enum: ['campaign', 'adset', 'ad'] }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 }, accountOffset: { type: 'integer', minimum: 0 } }, additionalProperties: false } },
    { name: 'get_live_ad_status', description: 'Read live configured and effective status for a campaign, ad set, or ad verified in stored insights. Requires Ads read access and an enabled connected account visible to your page scope.', inputSchema: { type: 'object', required: ['adAccountId', 'objectId', 'objectType'], properties: { adAccountId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' }, objectId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' }, objectType: { type: 'string', enum: ['campaign', 'adset', 'ad'] } }, additionalProperties: false } },
    { name: 'create_ad_campaign', description: 'Create a paused campaign in the selected advertising account. Use the selected platform objective and exact confirmation format.', inputSchema: { type: 'object', required: ['adAccountId', 'name', 'objective', 'confirmation', 'requestId'], properties: { adAccountId: { type: 'string' }, name: { type: 'string' }, objective: { type: 'string', minLength: 1, maxLength: 100 }, confirmation: { type: 'string' }, requestId: { type: 'string', description: 'Stable request identity; reuse for retries of the same reviewed payload.' } }, additionalProperties: false } },
    { name: 'create_ad_set', description: 'Create a paused ad set under a campaign verified in the selected account. Requires all Pages in scope. Confirmation must exactly match the account platform format.', inputSchema: { type: 'object', required: ['adAccountId', 'campaignId', 'name', 'dailyBudgetMinor', 'countryCode', 'optimizationGoal', 'confirmation', 'requestId'], properties: { adAccountId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' }, campaignId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' }, name: { type: 'string', minLength: 1, maxLength: 100 }, dailyBudgetMinor: { type: 'integer', minimum: 1 }, countryCode: { type: 'string', pattern: '^[A-Z]{2}$' }, optimizationGoal: { type: 'string', minLength: 1, maxLength: 100 }, confirmation: { type: 'string', maxLength: 500 }, requestId: { type: 'string', description: 'Stable request identity; reuse for retries of the same reviewed payload.' } }, additionalProperties: false } },
    { name: 'update_ad', description: 'Apply one status or budget change through the durable Ads management service. Supply the exact confirmation from preview_ads_change and a stable requestId reused for retries. Unknown outcomes remain held.', inputSchema: { type: 'object', required: ['adAccountId', 'objectId', 'objectType', 'confirmation', 'requestId'], properties: { adAccountId: { type: 'string' }, objectId: { type: 'string' }, objectType: { type: 'string', enum: ['campaign', 'adset', 'ad'] }, status: { type: 'string', enum: ['active', 'paused'] }, dailyBudgetMinor: { type: 'integer', minimum: 1 }, lifetimeBudgetMinor: { type: 'integer', minimum: 1 }, confirmation: { type: 'string' }, requestId: { type: 'string' } }, additionalProperties: false } },
    ]],
    features: {
      get_ads_report_rows: 'ads/campaigns',
      export_ads_report: 'ads/campaigns',
      list_ad_accounts: 'ads/campaigns',
      get_ad_creation_options: 'ads/campaigns',
      get_ads_performance: 'ads/campaigns',
      get_live_ad_status: 'ads/campaigns',
      create_ad_campaign: 'ads/campaigns',
      create_ad_set: 'ads/campaigns',
      update_ad: 'ads/campaigns',
    },
    writeTools: ['create_ad_campaign', 'create_ad_set', 'update_ad'],
    scope: { resourceTools: ['get_ads_report_rows', 'export_ads_report', 'list_ad_accounts', 'get_ad_creation_options', 'get_ads_performance', 'get_live_ad_status', 'create_ad_campaign', 'create_ad_set', 'update_ad'], resources: ['msp://ads/performance', 'msp://ads/daily'] },
    managers: [{ tools: ADS_MANAGER_TOOLS, message: 'Only workspace owners and admins can manage ads.', hideFromList: true, inExecutor: true }],
    errorBoundary: adsErrorBoundary,
    lockedReads: ['get_live_ad_status'],
    resources: [
      { uri: 'msp://ads/performance', name: "Ads performance", description: "Stored campaign, ad set, and ad performance for the default date range.", mimeType: 'application/json', feature: 'ads/campaigns', readTool: 'get_ads_performance' },
      { uri: 'msp://ads/daily', name: "Ads daily metrics", description: "Bounded daily stored Ads metrics, actions, additional fields and fetch provenance. Continue through get_ads_report_rows.", mimeType: 'application/json', feature: 'ads/campaigns', readTool: 'get_ads_report_rows' },
    ],
    execute: async (viewer, name, args, cap) => {
      switch (name) {
      case 'list_ad_accounts': return listAdsAccounts({ ...adsActorFor(viewer), allowedPlatformIds: entitledPlatformIds(viewer.entitlements) }, args, cap);
      case 'get_ads_report_rows': {
        if (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || (args.limit as number) < 1 || (args.limit as number) > ADS_MCP_MAX_PAGE_ITEMS)) {
          throw new OperationError('invalid_request', `limit must be an integer from 1 to ${ADS_MCP_MAX_PAGE_ITEMS}.`);
        }
        return readAdsDailyRows(adsActorFor(viewer), args, { maxItems: cap });
      }
      case 'export_ads_report':
        return exportAdsReport(adsActorFor(viewer), args, { maxItems: cap });
      case 'get_ads_performance': return readAdsPerformance({ ...adsActorFor(viewer), allowedPlatformIds: entitledPlatformIds(viewer.entitlements) }, args, cap);
      case 'get_live_ad_status': {
        const adAccountId = requiredString(args, 'adAccountId');
        const objectId = requiredString(args, 'objectId');
        const objectType = requiredString(args, 'objectType') as 'campaign' | 'adset' | 'ad';
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(adAccountId) || !/^[A-Za-z0-9_-]{1,100}$/.test(objectId) || !['campaign', 'adset', 'ad'].includes(objectType)) throw new OperationError('invalid_request', 'Invalid ad object request.');
        return readWorkspaceAdObject(adsActorFor(viewer), { adAccountId, objectId, objectType }, adsTargetIdsFor(viewer));
      }
      case 'get_ad_creation_options': return readAdsCreationOptions({ ...adsActorFor(viewer), allowedPlatformIds: entitledPlatformIds(viewer.entitlements) }, args);
      case 'create_ad_campaign': {
        const adAccountId = requiredString(args, 'adAccountId');
        const nameValue = requiredString(args, 'name');
        const objective = requiredString(args, 'objective');
        const confirmation = requiredString(args, 'confirmation');
        const requestId = requiredString(args, 'requestId');
        const result = await createWorkspaceAdCampaign(adsActorFor(viewer), { adAccountId, name: nameValue, objective, confirmation, requestId });
        if (result.outcome !== 'succeeded' || !result.created) return result;
        return confirmedAdsReceipt(result, await auditConfirmedAdsWrite(viewer, name, { adAccountId, campaignId: result.campaignId, operationId: result.operationId }));
      }
      case 'create_ad_set': {
        const adAccountId = requiredString(args, 'adAccountId');
        const campaignId = requiredString(args, 'campaignId');
        const nameValue = requiredString(args, 'name');
        const dailyBudgetMinor = args.dailyBudgetMinor;
        const countryCode = requiredString(args, 'countryCode');
        const optimizationGoal = requiredString(args, 'optimizationGoal');
        const confirmation = requiredString(args, 'confirmation');
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(adAccountId) || !/^[A-Za-z0-9_-]{1,100}$/.test(campaignId) || typeof dailyBudgetMinor !== 'number' || !Number.isSafeInteger(dailyBudgetMinor) || dailyBudgetMinor < 1 || !/^[A-Z]{2}$/.test(countryCode)) throw new OperationError('invalid_request', 'Invalid ad set request.');
        if (adsTargetIdsFor(viewer) !== undefined) throw new OperationError('forbidden', 'Ad set creation is unavailable for limited page access.');
        const requestId = requiredString(args, 'requestId');
        const unrestricted = adsTargetIdsFor(viewer) === undefined;
        const result = await createWorkspaceAdSet(adsActorFor(viewer), { adAccountId, campaignId, name: nameValue, dailyBudgetMinor, countryCode, optimizationGoal, confirmation, requestId }, unrestricted);
        if (result.outcome !== 'succeeded' || !result.created) return result;
        return confirmedAdsReceipt(result, await auditConfirmedAdsWrite(viewer, name, { adAccountId, campaignId, adSetId: result.adSetId, operationId: result.operationId }));
      }
      case 'update_ad': {
        const adAccountId = requiredString(args, 'adAccountId');
        const objectId = requiredString(args, 'objectId');
        const objectType = requiredString(args, 'objectType') as AdMutationRequest['objectType'];
        const status = args.status === undefined ? undefined : requiredString(args, 'status') as AdMutationRequest['status'];
        const dailyBudgetMinor = args.dailyBudgetMinor;
        const lifetimeBudgetMinor = args.lifetimeBudgetMinor;
        if ((dailyBudgetMinor !== undefined && typeof dailyBudgetMinor !== 'number') || (lifetimeBudgetMinor !== undefined && typeof lifetimeBudgetMinor !== 'number')) throw new OperationError('invalid_request', 'Budgets must be positive whole minor currency units.');
        const confirmation = requiredString(args, 'confirmation');
        const requestId = requiredString(args, 'requestId');
        const result = await updateWorkspaceAd(adsActorFor(viewer), { adAccountId, objectId, objectType, status, dailyBudgetMinor, lifetimeBudgetMinor, confirmation, requestId });
        if (result.outcome !== 'succeeded') return result;
        return auditedReceipt(viewer, name, { adAccountId, objectId, operationId: result.operationId }, result);
      }
        default: throw new OperationError('invalid_request', `Unknown tool: ${name}`);
      }
    },
  },
  {
    id: 'ads-analysis',
    tools: adsAnalysisToolDefinitions,
    features: {
      compare_ads_performance: 'ads/compare',
    },
    scope: { resourceTools: ['compare_ads_performance'] },
    execute: (viewer, name, args, cap) => executeAdsAnalysisTool(adsActorFor(viewer), name, args, cap),
  },
  {
    id: 'ads-directory',
    tools: adsDirectoryToolDefinitions,
    features: {
      list_ads_objects: 'ads/objects',
      get_ads_object: 'ads/objects',
    },
    scope: { resourceTools: ['list_ads_objects', 'get_ads_object'], resources: ['msp://ads/objects'] },
    resources: [
      { uri: 'msp://ads/objects', name: "Ad objects", description: "Current authorized stored object report page.", mimeType: 'application/json', feature: 'ads/objects', readTool: 'list_ads_objects' },
    ],
    execute: async (viewer, name, args, cap) => { ensureAdsManagement(); return executeAdsDirectoryTool(adsActorFor(viewer), name, args, cap); },
  },
  {
    id: 'ads-management',
    tools: adsManagementToolDefinitions,
    features: {
      get_ads_management_options: 'ads/campaigns',
      get_ads_creative_image: 'ads/campaigns',
      preview_ads_change: 'ads/campaigns',
      apply_ads_change: 'ads/campaigns',
      list_ads_changes: 'ads/campaigns',
      resolve_ads_change: 'ads/campaigns',
      list_ads_creatives: 'ads/campaigns',
      list_ads_creative_sources: 'ads/campaigns',
    },
    writeTools: ['apply_ads_change', 'resolve_ads_change'],
    scope: { resourceTools: ['get_ads_management_options', 'get_ads_creative_image', 'preview_ads_change', 'apply_ads_change', 'list_ads_changes', 'resolve_ads_change', 'list_ads_creatives', 'list_ads_creative_sources'] },
    errorBoundary: adsErrorBoundary,
    execute: (viewer, name, args, cap) => executeAdsManagementTool(adsActorFor(viewer), name, args, cap),
  },
];
