import { deleteAsset } from '@/modules/media/server/library';
import { failure, readJson, reply, sameOrigin, viewerActor } from '@/modules/media/server/http';
import { OperationError } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function DELETE(request: Request, context: Context) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor('publishing/media', true); if (actor instanceof Response) return actor;
  try {
    const body = await readJson(request, 'Confirm the exact media deletion.');
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.hasOwn(body, 'id')) throw new OperationError('invalid_request', 'Choose a valid media deletion.');
    return reply(await deleteAsset(actor, { ...body, id: (await context.params).id }));
  } catch (error) { return failure(error, 'The media could not be deleted.'); }
}
