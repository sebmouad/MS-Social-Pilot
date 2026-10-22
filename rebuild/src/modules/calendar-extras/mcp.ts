import { OperationError } from '@/lib/operation-error';
import { pageIdsFor, type McpToolGroup } from '@/server/mcp/kit';
import { AREAS, FEATURES, type Actor, type Area } from './contracts';
import { calendarOptions, changeCalendarEntry, listCalendarEntries } from './server/service';
import { settings } from './server/settings';
const string = { type: 'string' };
const day = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const ids = { type: 'array', items: string };
const data = {
 dates: { type: 'object', required: ['title', 'date', 'yearly', 'targetIds'], properties: { title: string, date: day, yearly: { type: 'boolean' }, targetIds: ids }, additionalProperties: false },
 seasons: { type: 'object', required: ['name', 'startsOn', 'endsOn', 'targetIds', 'rule', 'shiftMinutes', 'extraTimes'], properties: { name: string, startsOn: day, endsOn: day, targetIds: ids, rule: { type: 'string', enum: ['pause', 'shift', 'fewer', 'more'] }, shiftMinutes: { type: 'integer' }, extraTimes: { type: 'array', items: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' } } }, additionalProperties: false },
 feeds: { type: 'object', required: ['name', 'targetIds'], properties: { name: string, targetIds: ids, groupId: { anyOf: [string, { type: 'null' }] } }, additionalProperties: false },
 notes: { type: 'object', required: ['label', 'day', 'color', 'targetId'], properties: { label: string, day, color: string, targetId: { anyOf: [string, { type: 'null' }] } }, additionalProperties: false },
 trends: { type: 'object', required: ['keywords'], properties: { keywords: ids }, additionalProperties: false },
};
export const calendarToolDefinitions = AREAS.flatMap(area => [
 { name: `get_calendar_${area}_options`, description: 'Read authorized channels, current Root policy, write availability and English/French customer copy.', inputSchema: { type: 'object', properties: { locale: { type: 'string', enum: ['en', 'fr'] } }, additionalProperties: false } },
 { name: `list_calendar_${area}`, description: 'Read stored workspace calendar information, narrowed to current selected channels. Follow offset/limit while hasMore is true. Holidays include coverage and recent topics include fetched times.', inputSchema: { type: 'object', required: ['from', 'to'], properties: { from: day, to: day, targetId: string, offset: { type: 'integer', minimum: 0 }, showAll: { type: 'boolean' }, locale: { type: 'string', enum: ['en', 'fr'] } }, additionalProperties: false } },
 { name: `change_calendar_${area}`, description: `Confirmed ${area} write. Read options first. Confirmation is <CREATE|UPDATE|DELETE> CALENDAR ${area.toUpperCase()} <workspaceId for create; entryId for update/delete>. Trends support update only, with workspaceId as entryId. Feeds support create/delete only. The feed address is returned once; keep it private.`, inputSchema: { type: 'object', required: ['operation', 'confirmation'], properties: { operation: { type: 'string', enum: area === 'trends' ? ['update'] : area === 'feeds' ? ['create', 'delete'] : ['create', 'update', 'delete'] }, id: string, data: data[area], confirmation: string, locale: { type: 'string', enum: ['en', 'fr'] } }, additionalProperties: false } },
]);
export async function executeCalendarTool(actor: Actor, name: string, args: Record<string, unknown>, ceiling?: number) {
 const { locale, ...input } = args;
 const localized = { ...actor, locale: locale === 'fr' ? 'fr' as const : 'en' as const };
 const area = AREAS.find(a => name === `get_calendar_${a}_options` || name === `list_calendar_${a}` || name === `change_calendar_${a}`);
 const { copy } = await settings(localized.locale);
 if (!area || locale !== undefined && locale !== 'en' && locale !== 'fr') throw new OperationError('invalid_request', copy.invalid);
 if (name === `get_calendar_${area}_options`) {
  if (Object.keys(input).length) throw new OperationError('invalid_request', copy.invalid);
  return calendarOptions(localized, area, ceiling);
 }
 return name === `list_calendar_${area}` ? listCalendarEntries(localized, area, input, ceiling) : changeCalendarEntry(localized, area, input);
}
const writes = AREAS.map(a => `change_calendar_${a}`);
export const CALENDAR_EXTRAS_MCP: readonly McpToolGroup[] = [{
 id: 'calendar-extras', tools: calendarToolDefinitions,
 features: Object.fromEntries(AREAS.flatMap(a => [`get_calendar_${a}_options`, `list_calendar_${a}`, `change_calendar_${a}`].map(name => [name, FEATURES[a]]))),
 writeTools: writes, selfLockedWrites: writes,
 // Workspace-level objects and durable subscription tokens cannot widen a resource-restricted credential.
 scope: { workspaceTools: calendarToolDefinitions.map(t => t.name) },
 execute: (viewer, name, args, cap) => executeCalendarTool({ userId: viewer.userId, workspaceId: viewer.workspaceId, allowedTargetIds: pageIdsFor(viewer), permissionCeiling: viewer.permissions, apiKeyId: viewer.apiKeyId }, name, args, cap),
}];
