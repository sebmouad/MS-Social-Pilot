import { withSharingErrors } from '@/app/api/sharing/_http';
import { listShareFeedback } from '@/modules/sharing/server/links';
import { failure, ownerActor, reply } from '../../../_http';
export const dynamic = 'force-dynamic';

/** Owner-only list of the answers clients gave through one link. */
async function GETHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await ownerActor('sharing', false); if (!actor) return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401);
  try {
    const { id } = await context.params; const params = new URL(request.url).searchParams; const page = params.get('page');
    if ([...params.keys()].some(k => k !== 'page') || (page !== null && !/^[1-9]\d{0,3}$/.test(page))) return reply({ error: 'Choose a valid result page.', code: 'invalid_request' }, 400);
    return reply(await listShareFeedback(actor, { id, ...(page ? { page: Number(page) } : {}) }));
  } catch (error) { return failure(error, 'Feedback could not be loaded.'); }
}

export const GET = withSharingErrors(GETHandler);
