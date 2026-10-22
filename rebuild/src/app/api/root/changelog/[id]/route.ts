import { z } from 'zod';
import { removeRootChangelogEntry } from '@/modules/history/server/changelog';
import { readBody, rootRoute } from '@/server/root/legacy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export const DELETE = rootRoute<Ctx>({ write: true }, async (request, actorId, { params }) => {
  const body = z.object({ confirmation: z.string() }).strict().parse(await readBody(request));
  return removeRootChangelogEntry(actorId, (await params).id, body.confirmation);
});
