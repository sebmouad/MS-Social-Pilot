import { requireAuth } from '@/lib/auth';
import { syncAccountTargets } from '@/lib/accounts';
import { prisma } from '@/lib/prisma';
import { fail, ok, route } from '@/lib/api';

/** Re-read Pages and Groups from Facebook and refresh the stored page tokens. */
export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;

  const account = await prisma.socialAccount.findFirst({
    where: { id, workspaceId: auth.workspace.id },
    select: { id: true },
  });
  if (!account) return fail('Account not found.', 404);

  return ok(await syncAccountTargets(account.id));
});
