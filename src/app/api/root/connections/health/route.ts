import { requireRootApi } from '@/lib/auth';
import { checkWorkspace } from '@/lib/health';
import { ok, route } from '@/lib/api';
import { errors } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

/**
 * The live connection check for one workspace, root only. It calls Graph once
 * per app, account and destination, so it runs when root asks for it.
 */
export const POST = route(async (request: Request) => {
  await requireRootApi();
  const body = (await request.json().catch(() => ({}))) as { workspaceId?: unknown };
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const workspace = workspaceId ? await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } }) : null;
  if (!workspace) throw errors.notFound();
  return ok(await checkWorkspace(workspace.id));
});
