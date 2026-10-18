import { withSharingErrors } from '@/app/api/sharing/_http';
import { deleteShareLink, revokeShareLink, rotateShareLink, updateShareLink } from '@/modules/sharing/server/links';
import { absolute, failure, ownerActor, reply, sameOrigin } from '../../_http';
export const dynamic = 'force-dynamic';

/** POST { action: 'revoke' | 'rotate', confirmation } ; DELETE { confirmation }. The path id is authoritative. */
async function POSTHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await ownerActor('sharing', true); if (!actor) return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401);
  try {
    const { id } = await context.params; const body = await request.json() as { action?: unknown; confirmation?: unknown };
    if (body.action === 'revoke') return reply(await revokeShareLink(actor, { id, confirmation: body.confirmation }));
    if (body.action === 'rotate') { const result = await rotateShareLink(actor, { id, confirmation: body.confirmation }); return reply({ ...result, url: absolute(request, result.path) }); }
    return reply({ error: 'Choose revoke or rotate.', code: 'invalid_request' }, 400);
  } catch (error) { return failure(error, 'The share link change could not be confirmed. Refresh before trying again.'); }
}
/** PATCH { expectedVersion, ...fields, confirmation? }. Access changes replace the address, returned once as `url`. 409 on a stale version. */
async function PATCHHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await ownerActor('sharing', true); if (!actor) return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401);
  try {
    const { id } = await context.params; const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Enter valid details.', code: 'invalid_request' }, 400);
    // The path id is authoritative; a body id is refused by the strict schema only if it differs.
    const { id: bodyId, ...fields } = body as Record<string, unknown>;
    if (bodyId !== undefined && bodyId !== id) return reply({ error: 'Enter valid details.', code: 'invalid_request' }, 400);
    const result = await updateShareLink(actor, { ...fields, id });
    return reply(result.path ? { ...result, url: absolute(request, result.path) } : result);
  } catch (error) { return failure(error, 'The share link change could not be confirmed. Refresh before trying again.'); }
}
async function DELETEHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await ownerActor('sharing', true); if (!actor) return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401);
  try { const { id } = await context.params; const body = await request.json() as { confirmation?: unknown }; return reply(await deleteShareLink(actor, { id, confirmation: body.confirmation })); }
  catch (error) { return failure(error, 'The share link could not be deleted.'); }
}

export const POST = withSharingErrors(POSTHandler);
export const PATCH = withSharingErrors(PATCHHandler);
export const DELETE = withSharingErrors(DELETEHandler);
