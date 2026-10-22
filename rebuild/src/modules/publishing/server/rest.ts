
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { revalidatePath } from 'next/cache';
import { requestOrigin } from '@/server/request-origin';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import type { PublishingActor } from './types';

export const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

const REFRESH = ['/content', '/content/calendar', '/content/queue', '/content/approvals'];

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}

/** Same exact confirmation strings as the MCP tools: REST and MCP writes ask for the same deliberate acknowledgement. */
export function requireBodyConfirmation(body: Record<string, unknown>, expected: string, errorText: PublishingErrorText = defaultPublishingErrorText) {
  if (body.confirmation !== expected) throw new PublishingOperationError('invalid_request', 'confirmationRequiredRepeatTheCallWithConfirmationExactlyValue0', {value0: expected}, errorText);
}

export function bodyString(body: Record<string, unknown>, key: string, errorText: PublishingErrorText = defaultPublishingErrorText) {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim()) throw new PublishingOperationError('invalid_request', 'value0IsRequired', {value0: key}, errorText);
  return value.trim();
}

export function bodyInstant(body: Record<string, unknown>, key: string, errorText: PublishingErrorText = defaultPublishingErrorText) {
  const text = bodyString(body, key, errorText);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || !/^\d{4}-\d\d-\d\dT/.test(text)) throw new PublishingOperationError('invalid_request', 'value0MustBeAnISODatetime', {value0: key}, errorText);
  return { text, date };
}

type Handler = (context: { actor: PublishingActor; body: Record<string, unknown>; workspaceTimeZone: string }) => Promise<unknown>;

/**
 * Thin REST entry for Publishing writes. Origin, session, feature/write permission and channel scope are enforced here and again by
 * the shared service the handler calls; business rules never live in the route.
 */
export async function publishingWrite(request: Request, handle: Handler, options: { status?: number; failure?: string; body?: boolean } = {}) {
  const errorText = await loadPublishingErrorText();
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let viewer;
  try { viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true, write: true }); }
  catch { return reply({ error: 'Not authorized.', code: 'unauthorized' }, 401); }
  try {
    let body: Record<string, unknown> = {};
    if (options.body !== false) {
      const parsed: unknown = await request.json().catch(() => { throw new PublishingOperationError('invalid_request', 'sendAValidJSONRequest', {}, errorText); });
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new PublishingOperationError('invalid_request', 'sendAValidJSONRequest', {}, errorText);
      body = parsed as Record<string, unknown>;
    }
    const scope = viewer.permissions.pageScope;
    const actor: PublishingActor = { userId: viewer.user.id, workspaceId: viewer.workspaceId, ...(scope.all ? {} : { allowedTargetIds: scope.ids }) };
    const result = await handle({ actor, body, workspaceTimeZone: viewer.membership.workspace.timezone });
    // The service has already committed; cache refresh problems must not turn that into an apparent failure.
    for (const path of REFRESH) { try { revalidatePath(path); } catch { /* Keep the committed receipt as the response. */ } }
    return reply(result, options.status ?? 200);
  } catch (error) {
    const failure = operationFailure(error, options.failure ?? 'The outcome could not be confirmed. Refresh Posts and check the post before trying again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
