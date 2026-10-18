import { readDemographics } from './server/demographics';
import type { Actor } from '../server/access';

export const analyticsDemographicsTools = new Set<string>(['get_analytics_demographics']);
export const analyticsDemographicsWriteTools = new Set<string>();
const idList = { type: 'array', items: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,200}$' }, maxItems: 500 };
const day = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
export const analyticsDemographicsToolDefinitions = [{
  name: 'get_analytics_demographics',
  description: 'Read stored audience breakdowns (country, city, age and gender, language and any other configured dimension) for the selected authorized channels. Rows show shares of each breakdown; combined rows add category counts across sources and are not unique people. Missing data is unknown, not zero. No provider request is made.',
  inputSchema: { type: 'object', properties: { start: day, end: day, compare: { type: 'string', enum: ['none', 'previous', 'year'] }, filter: { type: 'string', enum: ['1'] }, channel: idList }, additionalProperties: false },
}] as const;
export async function executeAnalyticsDemographicsTool(actor: Actor, args: unknown) {
  return readDemographics(actor, args ?? {});
}
