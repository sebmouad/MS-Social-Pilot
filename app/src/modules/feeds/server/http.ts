import { requestOrigin } from '@/server/request-origin';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { FEEDS_FEATURE_ID } from '../manifest';
import type { FeedActor } from './access';
import { feedsError, feedsMessage } from './messages';

/** Thin-route helpers of the feeds HTTP API (same-origin writes, strict input, JSON errors). */
export const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}
/** Failure reply in the request's language: both the service message and the route's fallback are catalog phrases; unknown text passes through unchanged. */
export const failure = async (error: unknown, fallback: string) => {
  const f = operationFailure(error, fallback);
  return reply({ error: await feedsMessage(f.error), code: f.code }, f.status);
};
export async function viewerActor(write: boolean): Promise<FeedActor | Response> {
  try {
    const viewer = await requireViewer({ feature: FEEDS_FEATURE_ID, channelScoped: true, ...(write ? { write: true } : {}) });
    return { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  } catch { return reply({ error: await feedsMessage('Sign in to an authorized workspace.'), code: 'unauthorized' }, 401); }
}
/** `message` is the catalog phrase of the failure, so routes keep passing plain English and get the request's language. */
export async function readJson(request: Request, message: string): Promise<unknown> {
  try { return await request.json(); } catch { throw await feedsError('invalid_request', message); }
}
export const strictQuery = (request: Request, allowed: readonly string[]) => {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) throw new OperationError('invalid_request', 'Choose valid filters.');
  return params;
};
