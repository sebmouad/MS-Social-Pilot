import { revalidatePath } from 'next/cache';
import { requestOrigin } from '@/server/request-origin';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import type { PublishingActor } from './types';

export const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

const REFRESH = ['/publishing/posts', '/publishing/calendar', '/publishing/queue', '/publishing/approvals'];

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}

/** Same exact confirmation strings as the MCP tools: REST and MCP writes ask for the same deliberate acknowledgement. */
export function requireBodyConfirmation(body: Record<string, unknown>, expected: string) {
  if (body.confirmation !== expected) throw new OperationError('invalid_request', `Confirmation required. Repeat the call with confirmation exactly: ${expected}`);
}

export function bodyString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim()) throw new OperationError('invalid_request', `${key} is required.`);
  return value.trim();
}

export function bodyInstant(body: Record<string, unknown>, key: string) {
  const text = bodyString(body, key);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || !/^\d{4}-\d\d-\d\dT/.test(text)) throw new OperationError('invalid_request', `${key} must be an ISO date-time.`);
  return { text, date };
}

type Handler = (context: { actor: PublishingActor; body: Record<string, unknown>; workspaceTimeZone: string }) => Promise<unknown>;

/**
 * Thin REST entry for Publishing writes. Origin, session, feature/write permission and channel scope are enforced here and again by
 * the shared service the handler calls; business rules never live in the route.
 */
export async function publishingWrite(request: Request, handle: Handler, options: { status?: number; failure?: string; body?: boolean } = {}) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let viewer;
  try { viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true, write: true }); }
  catch { return reply({ error: 'Not authorized.', code: 'unauthorized' }, 401); }
  try {
    let body: Record<string, unknown> = {};
    if (options.body !== false) {
      const parsed: unknown = await request.json().catch(() => { throw new OperationError('invalid_request', 'Send a valid JSON request.'); });
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new OperationError('invalid_request', 'Send a valid JSON request.');
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
