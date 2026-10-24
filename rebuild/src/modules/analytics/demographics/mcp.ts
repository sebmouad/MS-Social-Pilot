import { readDemographics } from './server/demographics';
import type { Actor } from '../server/access';

export const analyticsDemographicsTools = new Set<string>(['get_analytics_demographics']);
export const analyticsDemographicsWriteTools = new Set<string>();
const idList = { type: 'array', items: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,200}$' }, maxItems: 500 };
const day = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
export const analyticsDemographicsToolDefinitions = [{
  name: 'get_analytics_demographics',
  description: 'Read full stored audience snapshot history with as-of/fetch dates and coverage; format csv includes the scoped history CSV. Oversized history is trimmed oldest-first and marked (historyTruncated with shown/total counts; a truncated,true marker row in CSV). Read stored audience breakdowns (country, city, age and gender, language and any other configured dimension) for the selected authorized channels. Rows show shares within each complete stored snapshot. Snapshots are separate by resource and date; no cross-source or cross-date sums are made. Missing data is unknown, not zero. No provider request is made.',
  inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['json', 'csv'] }, start: day, end: day, compare: { type: 'string', enum: ['none', 'previous', 'year'] }, filter: { type: 'string', enum: ['1'] }, channel: idList }, additionalProperties: false },
}] as const;
export async function executeAnalyticsDemographicsTool(actor: Actor, args: unknown) {
  return readDemographics(actor, args ?? {});
}
