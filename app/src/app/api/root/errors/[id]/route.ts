import { errorResolveSchema } from '@/modules/root/server/admin/shared';
import { getRootError, setRootErrorResolved } from '@/modules/root/server/admin/errors';
import { readBody, rootRoute, searchParamsObject } from '@/modules/root/server/admin/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export const GET = rootRoute<Ctx>({}, async (request, actorId, { params }) => { searchParamsObject(request); return { error: await getRootError(actorId, (await params).id) }; });
export const POST = rootRoute<Ctx>({ write: true }, async (request, actorId, { params }) => {
  const input = errorResolveSchema.parse(await readBody(request));
  return setRootErrorResolved(actorId, (await params).id, input.resolved, input.confirmation);
});
