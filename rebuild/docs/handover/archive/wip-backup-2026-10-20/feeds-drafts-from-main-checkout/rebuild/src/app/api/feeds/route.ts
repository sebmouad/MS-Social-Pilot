import { createFeed, readFeeds } from '@/modules/feeds/server/feeds';
import { failure, readJson, reply, sameOrigin, strictQuery, viewerActor } from '@/modules/media/server/http';
import { OperationError } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const actor = await viewerActor('publishing/posts', false); if (actor instanceof Response) return actor;
  try {
    const params = strictQuery(request, ['page']);
    const page = params.get('page');
    if (page !== null && !/^[1-9]\d{0,5}$/.test(page)) throw new OperationError('invalid_request', 'Choose a valid result page.');
    return reply(await readFeeds(actor, page ? { page: Number(page) } : {}));
  } catch (error) { return failure(error, 'Feeds could not be loaded.'); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor('publishing/posts', true); if (actor instanceof Response) return actor;
  try { return reply(await createFeed(actor, await readJson(request, 'Enter valid feed details.')), 201); }
  catch (error) { return failure(error, 'The feed could not be saved.'); }
}
