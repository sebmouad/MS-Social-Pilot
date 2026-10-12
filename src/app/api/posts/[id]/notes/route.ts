import { requireAuth } from '@/lib/auth';
import { errors } from '@/lib/errors';
import { assertPostInScope } from '@/lib/page-access';
import { addNote, listNotes, noteSchema, postMembers } from '@/lib/post-notes';
import { prisma } from '@/lib/prisma';
import { ok, readJson, route } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

/** A post of this workspace, on Pages this member may see. */
async function visiblePost(context: Context) {
  const auth = await requireAuth();
  const { id } = await context.params;
  await assertPostInScope(auth.pageScope, auth.workspace.id, id);
  const post = await prisma.post.findFirst({ where: { id, workspaceId: auth.workspace.id }, select: { id: true } });
  if (!post) throw errors.postNotFound();
  return { auth, postId: post.id };
}

/** Internal notes (H8): the thread, and who a new note may mention. */
export const GET = route(async (_request: Request, context: Context) => {
  const { auth, postId } = await visiblePost(context);
  const [notes, members] = await Promise.all([listNotes(postId), postMembers(auth.workspace.id, postId)]);
  return ok({ notes, members, me: auth.user.id });
});

export const POST = route(async (request: Request, context: Context) => {
  const { auth, postId } = await visiblePost(context);
  const input = noteSchema.parse(await readJson(request));
  const note = await addNote({ workspaceId: auth.workspace.id, postId, author: { id: auth.user.id, name: auth.user.name }, input });
  return ok({ note }, 201);
});
