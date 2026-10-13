import { requireCapability } from '@/lib/auth';
import { canModerateComments } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { savedReplySchema } from '@/lib/validation';
import { ok, readJson, route } from '@/lib/api';

/** Saved replies: for the people who answer comments and messages. */
export const GET = route(async () => {
  const auth = await requireCapability(canModerateComments);
  const replies = await prisma.savedReply.findMany({
    where: { workspaceId: auth.workspace.id },
    select: { id: true, name: true, body: true },
    orderBy: { name: 'asc' },
  });
  return ok({ replies });
});

export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canModerateComments);
  const input = savedReplySchema.parse(await readJson(request));
  const reply = await prisma.savedReply.create({
    data: { workspaceId: auth.workspace.id, ...input },
    select: { id: true, name: true, body: true },
  });
  return ok({ reply }, 201);
});
