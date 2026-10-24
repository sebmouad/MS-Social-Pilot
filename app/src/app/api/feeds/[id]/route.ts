import { deleteFeed, updateFeed } from '@/modules/feeds/server/feeds';
import { failure, readJson, reply, sameOrigin, viewerActor } from '@/modules/feeds/server/http';
import { OperationError } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const withId = async (request: Request, context: Context) => {
  const body = await readJson(request, 'Enter valid feed details.');
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.hasOwn(body, 'id')) throw new OperationError('invalid_request', 'Choose a valid feed.');
  return { ...body, id: (await context.params).id };
};
export async function PUT(request: Request, context: Context) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor(true); if (actor instanceof Response) return actor;
  try { return reply(await updateFeed(actor, await withId(request, context))); } catch (error) { return failure(error, 'The feed could not be saved.'); }
}
export async function DELETE(request: Request, context: Context) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor(true); if (actor instanceof Response) return actor;
  try { return reply(await deleteFeed(actor, await withId(request, context))); } catch (error) { return failure(error, 'The feed could not be deleted.'); }
}
