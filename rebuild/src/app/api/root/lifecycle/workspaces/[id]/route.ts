import { withinSynchronousLimit } from '@/lib/config/synchronous-policy';
import { z } from 'zod';
import { setLifecycleWorkspaceAccess } from '@/server/root/legacy/lifecycle';
import { deleteRootWorkspace } from '@/server/root/workspace-access';
import { readBody, rootRoute } from '@/server/root/legacy/http';

export const runtime = 'nodejs';
const schema = z.object({ suspended: z.boolean(), confirmation: z.string().min(1).refine(withinSynchronousLimit('root.confirmationMaxCharacters')) }).strict();

export const PATCH = rootRoute<{ params: Promise<{ id: string }> }>({ write: true }, async (request, actorId, { params }) => {
  const { id } = await params;
  const input = schema.parse(await readBody(request));
  return setLifecycleWorkspaceAccess(actorId, id, input.suspended, input.confirmation);
});

const deleteSchema = z.object({ confirmation: z.string().min(1).refine(withinSynchronousLimit('root.confirmationMaxCharacters')) }).strict();
/** Permanent deletion of a suspended workspace; see deleteRootWorkspace. */
export const DELETE = rootRoute<{ params: Promise<{ id: string }> }>({ write: true }, async (request, actorId, { params }) => {
  const { id } = await params;
  const input = deleteSchema.parse(await readBody(request));
  return deleteRootWorkspace(actorId, id, input.confirmation);
});
