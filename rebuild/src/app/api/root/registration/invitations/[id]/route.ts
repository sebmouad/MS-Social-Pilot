import { z } from 'zod';
import { revokeRootRegistrationInvitation } from '@/server/root/registration-admin';
import { readBody, rootRoute } from '@/server/root/legacy/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const DELETE = rootRoute<{ params: Promise<{ id: string }> }>({ write: true }, async (request, actorId, { params }) => {
  const value = z.object({ workspaceId: z.string(), confirmation: z.string() }).strict().parse(await readBody(request));
  return revokeRootRegistrationInvitation(actorId, value.workspaceId, (await params).id, { confirmation: value.confirmation });
});
