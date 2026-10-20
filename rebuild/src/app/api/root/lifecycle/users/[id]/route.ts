import { z } from 'zod';
import { setLifecycleUserAccess } from '@/server/root/legacy/lifecycle';
import { readBody, rootRoute } from '@/server/root/legacy/http';
import { deleteRootUser } from '@/server/root/user-controls';

export const runtime = 'nodejs';
const schema = z.object({ disabled: z.boolean(), confirmation: z.string().min(1).max(400) }).strict();

export const PATCH = rootRoute<{ params: Promise<{ id: string }> }>({ write: true }, async (request, actorId, { params }) => {
  const { id } = await params;
  const input = schema.parse(await readBody(request));
  return setLifecycleUserAccess(actorId, id, input.disabled, input.confirmation);
});

const deleteSchema = z.object({ confirmation: z.string().min(1).max(400) }).strict();
/** Permanent deletion of a disabled account; see deleteRootUser. */
export const DELETE = rootRoute<{ params: Promise<{ id: string }> }>({ write: true }, async (request, actorId, { params }) => {
  const { id } = await params;
  const input = deleteSchema.parse(await readBody(request));
  return deleteRootUser(actorId, id, input.confirmation);
});
