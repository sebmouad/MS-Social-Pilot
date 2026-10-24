import { requireViewer } from '@/server/context';
import { requestOrigin } from '@/server/request-origin';
import { readBoundedJson } from '@/server/http/body';
import { operationFailure, OperationError } from '@/lib/operation-error';
import { FEATURES, type Area, type Locale } from '../contracts';
import { settings } from './settings';
import { calendarOptions, changeCalendarEntry, listCalendarEntries } from './service';
import { renderCalendarFeed } from './subscriptions';
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
export const localeFor = (request: Request): Locale => /^\s*fr\b/i.test(request.headers.get('accept-language') ?? '') ? 'fr' : 'en';
/** Bind these module-owned handlers in thin app/api routes (see INTEGRATION.md). */
export function calendarCollectionHttp(area: Area) {
 return async (request: Request) => {
  const locale = localeFor(request);
  const { policy, copy } = await settings(locale);
  try {
   if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) return json({ code: 'invalid_request', error: copy.invalid }, 405);
   const write = request.method !== 'GET';
   if (write && request.headers.get('origin') !== requestOrigin(request)) throw new OperationError('forbidden', copy.denied);
   const viewer = await requireViewer({ feature: FEATURES[area], channelScoped: true });
   const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId, locale };
   if (write) {
    const raw = await readBoundedJson(request, policy.requestMaxBytes);
    // One POST operation endpoint supports create/update/delete identically to MCP and server actions.
    return json(await changeCalendarEntry(actor, area, raw));
   }
   const params = new URL(request.url).searchParams;
   if (params.has('showAll') && !['true', 'false'].includes(params.get('showAll') ?? '')) throw new OperationError('invalid_request', copy.invalid);
   if (params.size === 1 && params.get('view') === 'options') return json(await calendarOptions(actor, area));
   if ([...params.keys()].some(k => !['from', 'to', 'offset', 'targetId', 'showAll'].includes(k) || params.getAll(k).length !== 1)) throw new OperationError('invalid_request', copy.invalid);
   return json(await listCalendarEntries(actor, area, { from: params.get('from'), to: params.get('to'), offset: params.has('offset') ? Number(params.get('offset')) : 0, ...(params.has('targetId') ? { targetId: params.get('targetId') } : {}), ...(params.has('showAll') ? { showAll: params.get('showAll') === 'true' } : {}) }));
  } catch (error) {
   const f = operationFailure(error, copy.unavailable);
   return json({ code: f.code, error: error instanceof OperationError ? error.message : ['unauthorized', 'forbidden'].includes(f.code) ? copy.denied : copy.unavailable }, f.status);
  }
 };
}
export async function calendarFeedHttp(_request: Request, context: { params: Promise<{ token: string }> }) {
 const { copy } = await settings(localeFor(_request));
 try {
  const body = await renderCalendarFeed((await context.params).token);
  if (body === null) return json({ error: copy.feedInvalid }, 404);
  return new Response(body, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-disposition': 'inline; filename="calendar.ics"' } });
 } catch { return json({ error: copy.feedInvalid }, 503); }
}

export function calendarItemHttp(area: Area) {
 return async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const { policy, copy } = await settings(localeFor(request));
  try {
   if (!['PATCH', 'DELETE'].includes(request.method)) return json({ code: 'invalid_request', error: copy.invalid }, 405);
   if (request.headers.get('origin') !== requestOrigin(request)) throw new OperationError('forbidden', copy.denied);
   const viewer = await requireViewer({ feature: FEATURES[area], channelScoped: true });
   const raw = await readBoundedJson(request, policy.requestMaxBytes);
   if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.hasOwn(raw, 'id') || Object.hasOwn(raw, 'operation')) throw new OperationError('invalid_request', copy.invalid);
   return json(await changeCalendarEntry({ userId: viewer.user.id, workspaceId: viewer.workspaceId, locale: localeFor(request) }, area, { ...raw, id: (await context.params).id, operation: request.method === 'DELETE' ? 'delete' : 'update' }));
  } catch (error) {
   const f = operationFailure(error, copy.unavailable);
   return json({ code: f.code, error: error instanceof OperationError ? error.message : ['unauthorized', 'forbidden'].includes(f.code) ? copy.denied : copy.unavailable }, f.status);
  }
 };
}
