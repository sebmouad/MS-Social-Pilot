import { withinSynchronousLimit } from '@/lib/config/synchronous-policy';
import { z } from 'zod';
import { refreshRootConnection } from '@/server/root/legacy/connection-refresh';
import { readBody, rootRoute } from '@/server/root/legacy/http';

export const runtime = 'nodejs';
const schema = z.object({ confirmation: z.string().min(1).refine(withinSynchronousLimit('root.confirmationMaxCharacters')) }).strict();
export const POST = rootRoute<{ params: Promise<{ id: string }> }>({ write: true }, async (request, actorId, { params }) => {
  const { id } = await params;
  const { confirmation } = schema.parse(await readBody(request));
  return refreshRootConnection(actorId, { socialAccountId: id, confirmation });
});
