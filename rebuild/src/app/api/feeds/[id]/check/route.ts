import { checkFeed } from '@/modules/feeds/server/feeds';
import { failure, readJson, reply, sameOrigin, viewerActor } from '@/modules/feeds/server/http';
import { OperationError } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor(true); if (actor instanceof Response) return actor;
  try {
    const body = await readJson(request, 'Choose a valid feed check.');
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.hasOwn(body, 'id')) throw new OperationError('invalid_request', 'Choose a valid feed check.');
    return reply(await checkFeed(actor, { ...body, id: (await context.params).id }));
  } catch (error) { return failure(error, 'The feed could not be checked.'); }
}
