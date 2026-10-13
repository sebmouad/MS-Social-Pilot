import { z } from 'zod';

import { ok, readJson, route } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { errors } from '@/lib/errors';
import { addInboxNote, listInboxNotes } from '@/lib/inbox-notes';
import { targetScope } from '@/lib/page-access';
import { prisma } from '@/lib/prisma';

const itemSchema = z.object({ kind: z.enum(['comment', 'message']), id: z.string().min(1) });
const addSchema = itemSchema.extend({ body: z.string().trim().min(1).max(2000) });

async function pageIds(auth: Awaited<ReturnType<typeof requireAuth>>) {
  const pages = await prisma.target.findMany({ where: { workspaceId: auth.workspace.id, ...targetScope(auth.pageScope) }, select: { id: true } });
  return pages.map((page) => page.id);
}

export const GET = route(async (request: Request) => {
  const auth = await requireAuth();
  const params = new URL(request.url).searchParams;
  const input = itemSchema.parse({ kind: params.get('kind'), id: params.get('id') });
  const notes = await listInboxNotes({ workspaceId: auth.workspace.id, targetIds: await pageIds(auth), ...input });
  if (!notes) throw errors.notFound();
  return ok({ notes: notes.map((note) => ({ ...note, mine: note.authorId === auth.user.id })) });
});

export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = addSchema.parse(await readJson(request));
  const done = await addInboxNote({ workspaceId: auth.workspace.id, targetIds: await pageIds(auth), authorId: auth.user.id, ...input });
  if (!done) throw errors.notFound();
  return ok({ ok: true }, 201);
});
