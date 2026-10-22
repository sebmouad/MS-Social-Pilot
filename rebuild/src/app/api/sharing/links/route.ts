import { withSharingErrors } from '@/app/api/sharing/_http';
import { acceptLocale, labelShareLinks } from '@/modules/sharing/server/labels';
import { createShareLink, listShareLinks } from '@/modules/sharing/server/links';
import { absolute, failure, ownerActor, reply, sameOrigin } from '../_http';
export const dynamic = 'force-dynamic';

async function GETHandler(request: Request) {
  const actor = await ownerActor('sharing', false); if (!actor) return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401);
  try {
    const params = new URL(request.url).searchParams; const page = params.get('page');
    if ([...params.keys()].some(k => k !== 'page') || (page !== null && !/^[1-9]\d{0,3}$/.test(page))) return reply({ error: 'Choose a valid result page.', code: 'invalid_request' }, 400);
    return reply(await labelShareLinks(await listShareLinks(actor, page ? { page: Number(page) } : {}), actor.workspaceId, acceptLocale(request)));
  } catch (error) { return failure(error, 'Share links could not be loaded.'); }
}
async function POSTHandler(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await ownerActor('sharing', true); if (!actor) return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401);
  try { const created = await createShareLink(actor, await request.json()); return reply({ ...created, url: absolute(request, created.path) }, 201); }
  catch (error) { return failure(error, 'The share link could not be created.'); }
}

export const GET = withSharingErrors(GETHandler);
export const POST = withSharingErrors(POSTHandler);
