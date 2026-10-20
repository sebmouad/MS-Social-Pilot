import { z } from 'zod';
import { disconnectRootConnection } from '@/server/root/legacy/connections';
import { readBody, rootRoute } from '@/server/root/legacy/http';

export const runtime = 'nodejs';
const schema = z.object({ confirmation: z.string().min(1).max(400) }).strict();

/** Root disconnect, retain mode only; see disconnectRootConnection. */
export const POST = rootRoute<{ params: Promise<{ id: string }> }>({ write: true }, async (request, actorId, { params }) => {
  const { id } = await params;
  const input = schema.parse(await readBody(request));
  return disconnectRootConnection(actorId, id, input.confirmation);
});
