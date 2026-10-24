import { withinSynchronousLimit } from '@/lib/config/synchronous-policy';
import { z } from 'zod';
import { disconnectRootConnection, previewRootConnectionDeletion } from '@/modules/root/server/admin/connections';
import { readBody, rootRoute } from '@/modules/root/server/admin/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.object({ confirmation: z.string().min(1).refine(withinSynchronousLimit('root.confirmationMaxCharacters')), mode: z.enum(['retain', 'delete']).optional() }).strict();

/** Read-only estimate of the local rows that delete mode would remove. */
export const GET = rootRoute<{ params: Promise<{ id: string }> }>({ write: false }, async (_request, actorId, { params }) => previewRootConnectionDeletion(actorId, (await params).id));

/** Root disconnect: retain by default, or delete related local data with its own exact confirmation. */
export const POST = rootRoute<{ params: Promise<{ id: string }> }>({ write: true }, async (request, actorId, { params }) => {
  const { id } = await params;
  const input = schema.parse(await readBody(request));
  return disconnectRootConnection(actorId, id, input.confirmation, input.mode);
});
