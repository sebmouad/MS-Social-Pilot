import { requestOrigin } from '@/server/request-origin';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import type { ToolActor } from './access';
import { mediaError, mediaMessage } from './messages';

/** Shared thin-route helpers for the feeds, AI and media-library APIs. */
export const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}
/** Failure reply in the request's language: both the service message and the route's fallback are catalog phrases; unknown text passes through unchanged. */
export const failure = async (error: unknown, fallback: string) => {
  const f = operationFailure(error, fallback);
  return reply({ error: await mediaMessage(f.error), code: f.code }, f.status);
};
export async function viewerActor(feature: 'publishing/posts' | 'publishing/media', write: boolean): Promise<ToolActor | Response> {
  try {
    const viewer = await requireViewer({ feature, channelScoped: true, ...(write ? { write: true } : {}) });
    return { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  } catch { return reply({ error: await mediaMessage('Sign in to an authorized workspace.'), code: 'unauthorized' }, 401); }
}
/** `message` is the catalog phrase of the failure, so routes keep passing plain English and get the request's language. */
export async function readJson(request: Request, message: string): Promise<unknown> {
  try { return await request.json(); } catch { throw await mediaError('invalid_request', message); }
}
/** Synchronous for the routes; `failure` translates its catalog phrase into the request's language. */
export const strictQuery = (request: Request, allowed: readonly string[]) => {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) throw new OperationError('invalid_request', 'Choose valid filters.');
  return params;
};


/** Integrator: export this as PATCH from /api/media-library/[id]/route.ts. */
export async function renameMediaHttp(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return reply({ code: 'forbidden' }, 403);
  const actor = await viewerActor('publishing/media', true);
  if (actor instanceof Response) return actor;
  try {
    const body = await readJson(request, 'Choose valid media details and confirm the exact action.');
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.hasOwn(body, 'id')) throw await mediaError('invalid_request', 'Choose valid media details and confirm the exact action.');
    const { renameAsset } = await import('./library');
    return reply(await renameAsset(actor, { ...body, id: (await context.params).id }));
  } catch (error) { return failure(error, 'The media operation could not be confirmed. Refresh the library before trying again.'); }
}
