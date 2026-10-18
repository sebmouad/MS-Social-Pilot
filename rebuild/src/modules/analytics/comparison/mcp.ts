import { readAnalyticsComparison } from './server/comparison';
import type { Actor } from '../server/access';

export const analyticsComparisonTools = new Set<string>(['compare_analytics']);
export const analyticsComparisonWriteTools = new Set<string>();
const day = { type: 'string', description: 'Inclusive UTC date, YYYY-MM-DD.' };
const range = { type: 'object', required: ['start', 'end'], properties: { start: day, end: day }, additionalProperties: false };
const ids = { type: 'array', items: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,200}$' }, minItems: 1, maxItems: 500 };
export const analyticsComparisonToolDefinitions = [{
  name: 'compare_analytics',
  description: 'Compare stored Analytics either across two date ranges for the same channels (mode period) or across two disjoint groups of channels in one range (mode channels). Differences are calculated only for measures that can honestly be subtracted with matching coverage; reach, breakdowns and partially covered measures stay uncompared. Missing is unknown, not zero.',
  inputSchema: { type: 'object', required: ['mode'], properties: { mode: { type: 'string', enum: ['period', 'channels'] }, a: range, b: range, channel: ids, adAccount: ids, start: day, end: day, groupA: ids, groupB: ids }, additionalProperties: false },
}] as const;
export async function executeAnalyticsComparisonTool(actor: Actor, args: unknown) {
  return readAnalyticsComparison(actor, args);
}
