import { importFromUrl, readLibrary } from '@/modules/media/server/library';
import { failure, readJson, reply, sameOrigin, strictQuery, viewerActor } from '@/modules/media/server/http';
import { OperationError } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const actor = await viewerActor('publishing/media', false); if (actor instanceof Response) return actor;
  try {
    const params = strictQuery(request, ['kind', 'q', 'page', 'usage']);
    const page = params.get('page');
    if (page !== null && !/^[1-9]\d{0,3}$/.test(page)) throw new OperationError('invalid_request', 'Choose a valid result page.');
    return reply(await readLibrary(actor, { ...(params.has('kind') ? { kind: params.get('kind') } : {}), ...(params.has('q') ? { q: params.get('q') } : {}), ...(params.has('usage') ? { usage: params.get('usage') } : {}), ...(page ? { page: Number(page) } : {}) }));
  } catch (error) { return failure(error, 'The media library could not be loaded.'); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor('publishing/media', true); if (actor instanceof Response) return actor;
  try { return reply(await importFromUrl(actor, await readJson(request, 'Enter a valid web address.')), 201); }
  catch (error) { return failure(error, 'The media could not be imported.'); }
}
