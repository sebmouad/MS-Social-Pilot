import { readRecipeSource, saveRecipeSource } from '@/modules/feeds/server/wordpress';
import { withRecipeLabels } from '@/modules/feeds/server/recipe-labels';
import { feedsLocale } from '@/modules/feeds/copy';
import { failure, readJson, reply, sameOrigin, strictQuery, viewerActor } from '@/modules/feeds/server/http';
import { OperationError } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const actor = await viewerActor(false); if (actor instanceof Response) return actor;
  try {
    const params = strictQuery(request, ['page']);
    const page = params.get('page');
    if (page !== null && !/^[1-9]\d{0,5}$/.test(page)) throw new OperationError('invalid_request', 'Choose a valid result page.');
    return reply(withRecipeLabels(await readRecipeSource(actor, page ? { page: Number(page) } : {}), feedsLocale(request.headers.get('accept-language'))));
  } catch (error) { return failure(error, 'The recipe source could not be loaded.'); }
}
export async function PUT(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor(true); if (actor instanceof Response) return actor;
  try { return reply(await saveRecipeSource(actor, await readJson(request, 'Enter valid recipe source details.'))); }
  catch (error) { return failure(error, 'The recipe source could not be saved.'); }
}
