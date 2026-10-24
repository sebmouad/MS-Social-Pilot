import { analyticsActorFor, type McpToolGroup } from '@/server/mcp/kit';
import { readAdObjects } from './service';
import { AD_OBJECT_SORTS } from './aggregate';
export const adObjectsMcp: McpToolGroup = {
  id: 'analytics-ad-objects',
  tools: [{ name: 'get_analytics_ad_objects', description: 'Analyze stored campaigns, ad sets or ads. Parent drill-down requires an account. Figures cover stored days only; reach is a dated snapshot. Levels/currencies are never combined. CSV exports the full filtered selection or refuses it; narrow filters for MCP limits.', inputSchema: { type: 'object', properties: {
    sort: { type: 'string', enum: [...AD_OBJECT_SORTS], description: 'Sort within each account/currency before paging or CSV. Unknowns last; defaults to name.' }, direction: { type: 'string', enum: ['asc', 'desc'] }, start: { type: 'string' }, end: { type: 'string' }, accountId: { type: 'string' }, level: { type: 'string', enum: ['campaign', 'adset', 'ad'] }, parentId: { type: 'string' }, objectId: { type: 'string' }, page: { type: 'integer', minimum: 1 }, format: { type: 'string', enum: ['json', 'csv'] }, locale: { type: 'string', enum: ['en', 'fr'] },
  }, additionalProperties: false } }],
  features: { get_analytics_ad_objects: 'analytics/ads' },
  scope: { resourceTools: ['get_analytics_ad_objects'], resources: ['msp://analytics/ad-objects'] },
  resources: [{ uri: 'msp://analytics/ad-objects', name: 'Ad-object analysis', description: 'Stored campaign analysis with coverage and period provenance.', mimeType: 'application/json', feature: 'analytics/ads', readTool: 'get_analytics_ad_objects' }],
  execute: (viewer, _name, args, cap) => readAdObjects(analyticsActorFor(viewer, cap), args),
};
