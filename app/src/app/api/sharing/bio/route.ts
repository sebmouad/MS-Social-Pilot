import { withSharingErrors } from '@/app/api/sharing/_http';
import { deleteBioPage, readBioPage, saveBioPage } from '@/modules/sharing/server/bio';
import { failure, ownerActor, reply, sameOrigin } from '../_http';
export const dynamic = 'force-dynamic';

async function GETHandler() {
  const actor = await ownerActor('bio', false); if (!actor) return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401);
  try { return reply(await readBioPage(actor)); } catch (error) { return failure(error, 'The bio page could not be loaded.'); }
}
async function PUTHandler(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await ownerActor('bio', true); if (!actor) return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401);
  try { return reply(await saveBioPage(actor, await request.json())); } catch (error) { return failure(error, 'The bio page could not be saved.'); }
}
async function DELETEHandler(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await ownerActor('bio', true); if (!actor) return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401);
  try { return reply(await deleteBioPage(actor, await request.json())); } catch (error) { return failure(error, 'The bio page could not be deleted.'); }
}

export const GET = withSharingErrors(GETHandler);
export const PUT = withSharingErrors(PUTHandler);
export const DELETE = withSharingErrors(DELETEHandler);
