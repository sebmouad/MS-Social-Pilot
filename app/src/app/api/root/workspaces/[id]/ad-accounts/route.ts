import { withinSynchronousLimit } from '@/lib/config/synchronous-policy';
import { z } from 'zod';
import { previewRootOrphanAdAccounts, removeRootOrphanAdAccounts } from '@/server/root/workspace-access';
import { readBody, rootRoute } from '@/modules/root/server/admin/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.object({ confirmation: z.string().min(1).refine(withinSynchronousLimit('root.confirmationMaxCharacters')) }).strict();

/** Read-only: ad accounts of this workspace that no connection holds any more, and the phrase that removes them. */
export const GET = rootRoute<{ params: Promise<{ id: string }> }>({}, async (_request, actorId, { params }) => previewRootOrphanAdAccounts(actorId, (await params).id));

/** Removes those unlinked ad accounts (and their stored figures) from this installation; nothing is sent to Meta. */
export const DELETE = rootRoute<{ params: Promise<{ id: string }> }>({ write: true }, async (request, actorId, { params }) => {
  const input = schema.parse(await readBody(request));
  return removeRootOrphanAdAccounts(actorId, (await params).id, input.confirmation);
});
