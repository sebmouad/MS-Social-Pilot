import { loadAdsReadPolicy } from '../server/read-policy';
import { assertAdsResultCeiling, validateAdsResultCeiling } from '../result-ceiling';
import { OperationError } from '@/lib/operation-error';
import type { AdsReadActor } from '../server/access';
import { exportAdsDirectory, readAdsDirectory, readAdsObjectDetail } from './server';

export const adsDirectoryTools = new Set(['list_ads_objects', 'get_ads_object']);
export const adsDirectoryWriteTools = new Set<string>();
const range = { period: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, accountId: { type: 'string' } };
export const adsDirectoryToolDefinitions = [
  { name: 'list_ads_objects', description: 'Browse stored campaigns, ad sets or ads with period figures, last delivery day and freshness. Parent links are shown only when stored.',
    inputSchema: { type: 'object', properties: { ...range, level: { type: 'string', enum: ['campaign', 'adset', 'ad'] }, parentId: { type: 'string' }, q: { type: 'string' },
      sort: { type: 'string', enum: ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'name'] }, direction: { type: 'string', enum: ['asc', 'desc'] }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1 },
      format: { type: 'string', enum: ['json', 'csv'], description: 'csv returns every matching object as one complete CSV (no paging), or refuses when it exceeds the export limits.' } }, additionalProperties: false } },
  { name: 'get_ads_object', description: 'Read one ad object: stored totals and daily series, live status when the platform can be reached, and the changes you may make.',
    inputSchema: { type: 'object', required: ['accountId', 'level', 'objectId'], properties: { ...range, level: { type: 'string', enum: ['campaign', 'adset', 'ad'] }, objectId: { type: 'string' } }, additionalProperties: false } },
];
export async function executeAdsDirectoryTool(actor: AdsReadActor, name: string, args: Record<string, unknown>, maxResultItems?: number) {
  validateAdsResultCeiling(maxResultItems);
  if (name === 'list_ads_objects') {
    const { format, ...rest } = args;
    if (format !== undefined && format !== 'json' && format !== 'csv') throw new OperationError('invalid_request', 'Choose json or csv.');
    if (format === 'csv') {
      const exported = await exportAdsDirectory(actor, rest);
      if (maxResultItems !== undefined && exported.rowCount > maxResultItems) throw new OperationError('invalid_request', 'This export exceeds the result limit of this credential.');
      return exported;
    }
    const input = { ...rest };
    if (maxResultItems !== undefined) {
      if (typeof input.limit === 'number' && input.limit > maxResultItems) throw new OperationError('invalid_request', 'The page size exceeds the current result limit.');
      if (input.limit === undefined) input.limit = Math.min(maxResultItems, (await loadAdsReadPolicy()).pageSize);
    }
    const result = await readAdsDirectory(actor, input);
    assertAdsResultCeiling(result, maxResultItems);
    return result;
  }
  if (name === 'get_ads_object') {
    const result = await readAdsObjectDetail(actor, args);
    assertAdsResultCeiling(result, maxResultItems);
    return result;
  }
  throw new OperationError('invalid_request', 'Unknown Ads directory tool.');
}
