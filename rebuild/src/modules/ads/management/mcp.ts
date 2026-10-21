import { withAdsCopySnapshot } from '@/modules/ads/server/copy';
import { adsServiceText } from '@/modules/ads/server/copy';
import { assertAdsResultCeiling, validateAdsResultCeiling } from '../result-ceiling';
import { OperationError } from '@/lib/operation-error';
import { describeAdsManagement, readAdsCreativeImage, listAdsCreativeSources, listAdsCreatives, listAdsOperations, performAdsManagement, previewAdsManagement, resolveAdsOperation, type AdsManageActor } from './server';

const operation = { type: 'object', description: 'A neutral change: {type: status.set|budget.set|rename|creative.assign|delete, objectType, objectId, ...fields} or a paused creation: {type:"campaign.create", objectType:"campaign", name, objective} / {type:"adset.create", objectType:"adset", parentId (existing campaign id), name, dailyBudgetMinor, countryCode, optimizationGoal}. Creative creation: {type:"creative.create", objectType:"creative", name, targetId (selected channel), mediaId (stored workspace image filename), format:"image"|"link", message, title, linkUrl (HTTPS, required only for link)}. Creatives are unattached and cannot deliver or spend. Creations carry no objectId or status. Campaigns and ad sets start paused; creatives have no delivery state and stay unattached. Only changes the account advertises will succeed.' };
export const adsManagementTools = new Set(['get_ads_management_options', 'get_ads_creative_image', 'preview_ads_change', 'apply_ads_change', 'list_ads_changes', 'resolve_ads_change', 'list_ads_creatives', 'list_ads_creative_sources']);
export const adsManagementWriteTools = new Set(['apply_ads_change', 'resolve_ads_change']);
export const adsManagementToolDefinitions = [
  { name: 'get_ads_management_options', description: 'Read currently usable management operations and Root-managed limits for an account. Unavailable operations are omitted.', inputSchema: { type: 'object', required: ['adAccountId'], properties: { adAccountId: { type: 'string' } }, additionalProperties: false } },
  { name: 'get_ads_creative_image', description: 'Read a bounded stored workspace image available for creative creation as base64 with its MIME type. Requires current account management access.', inputSchema: { type: 'object', required: ['adAccountId', 'mediaId'], properties: { adAccountId: { type: 'string' }, mediaId: { type: 'string' } }, additionalProperties: false } },
  { name: 'list_ads_creative_sources', description: 'List selected channel identities and stored workspace images for creative creation. Continue with imageAfter or targetOffset.', inputSchema: { type: 'object', required: ['adAccountId'], properties: { adAccountId: { type: 'string' }, imageAfter: { type: 'string' }, targetOffset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'preview_ads_change', description: 'Validate an ad change and return the exact confirmation text and whether it can change spend. Makes no change.', inputSchema: { type: 'object', required: ['adAccountId', 'operation'], properties: { adAccountId: { type: 'string' }, operation }, additionalProperties: false } },
  { name: 'apply_ads_change', description: 'Apply an object change, create an unattached creative, or create a paused campaign/ad set after repeating the exact confirmation from preview_ads_change. An unknown outcome is recorded and must be resolved; it is never retried automatically. An error may include attempt:"not_dispatched": that describes only that one call. It does not prove an earlier call with the same requestId was not recorded, so after any lost or failed response keep reusing the same requestId and check list_ads_changes before creating anything new.', inputSchema: { type: 'object', required: ['adAccountId', 'operation', 'confirmation', 'requestId'], properties: { adAccountId: { type: 'string' }, operation, confirmation: { type: 'string' }, requestId: { type: 'string', description: 'Unique client request ID; reuse exactly for retries of this same confirmed change.' } }, additionalProperties: false } },
  { name: 'list_ads_changes', description: 'List recorded ad changes including unresolved unknown outcomes.', inputSchema: { type: 'object', properties: { adAccountId: { type: 'string' }, status: { type: 'string', enum: ['pending', 'succeeded', 'rejected', 'uncertain', 'resolved_applied', 'resolved_not_applied'] }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'resolve_ads_change', description: 'Record whether an unknown-outcome change was applied or not after checking the platform. For uncertain records use RESOLVE ADS CHANGE <id> AS APPLIED|NOT APPLIED. For pending recovery use RECOVER ADS CHANGE <id> AS APPLIED|NOT APPLIED; recovery refuses while a dispatch holds the account lock. Makes no remote call.', inputSchema: { type: 'object', required: ['operationId', 'resolution', 'confirmation'], properties: { operationId: { type: 'string' }, resolution: { type: 'string', enum: ['applied', 'not_applied'] }, note: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'list_ads_creatives', description: 'Browse existing creatives that can be assigned to an ad, when the platform supports it.', inputSchema: { type: 'object', required: ['adAccountId'], properties: { adAccountId: { type: 'string' }, after: { type: 'string' }, limit: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
];
export async function executeAdsManagementTool(actor: AdsManageActor, name: string, args: Record<string, unknown>, maxResultItems?: number) {
  return withAdsCopySnapshot(async () => {
  const allowed: Record<string, string[]> = {
    get_ads_management_options: ['adAccountId'], get_ads_creative_image: ['adAccountId', 'mediaId'],
    list_ads_creative_sources: ['adAccountId', 'imageAfter', 'targetOffset', 'limit'], preview_ads_change: ['adAccountId', 'operation'], apply_ads_change: ['adAccountId', 'operation', 'confirmation', 'requestId'], list_ads_changes: ['adAccountId', 'status', 'offset', 'limit'],
    resolve_ads_change: ['operationId', 'resolution', 'note', 'confirmation'], list_ads_creatives: ['adAccountId', 'after', 'limit'],
  };
  if (!allowed[name] || Object.keys(args).some(key => !allowed[name]!.includes(key))) throw new OperationError('invalid_request', await adsServiceText('service027'));
  validateAdsResultCeiling(maxResultItems);
  const input = { ...args };
  if (['list_ads_changes', 'list_ads_creatives', 'list_ads_creative_sources'].includes(name) && maxResultItems !== undefined) {
    if (input.limit !== undefined && (typeof input.limit !== 'number' || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > maxResultItems)) throw new OperationError('invalid_request', await adsServiceText('service028'));
    if (input.limit === undefined) input.limit = maxResultItems;
  }
  const checked = async (result: Promise<unknown>) => {
    const value = await result;
    assertAdsResultCeiling(value, maxResultItems);
    return value;
  };
  const a = input as never;
  switch (name) {
    case 'get_ads_management_options':
      if (typeof input.adAccountId !== 'string' || !input.adAccountId) throw new OperationError('invalid_request', await adsServiceText('service011'));
      return describeAdsManagement(actor, input.adAccountId);
    case 'get_ads_creative_image': {
      if (typeof input.adAccountId !== 'string' || !input.adAccountId || typeof input.mediaId !== 'string' || !input.mediaId) throw new OperationError('invalid_request', await adsServiceText('service029'));
      const image = await readAdsCreativeImage(actor, { adAccountId: input.adAccountId, mediaId: input.mediaId });
      return { mimeType: image.mimeType, byteLength: image.bytes.length, base64: Buffer.from(image.bytes).toString('base64') };
    }
    case 'list_ads_creative_sources': {
      const result = await listAdsCreativeSources(actor, a);
      if (maxResultItems !== undefined && (result.targets.length > maxResultItems || result.images.length > maxResultItems)) throw new OperationError('invalid_request', await adsServiceText('service030'));
      return result;
    }
    case 'preview_ads_change': return previewAdsManagement(actor, a);
    case 'apply_ads_change': return performAdsManagement(actor, a);
    case 'list_ads_changes': return checked(listAdsOperations(actor, a));
    case 'resolve_ads_change': return resolveAdsOperation(actor, a);
    default: return checked(listAdsCreatives(actor, a));
  }

  });
}
