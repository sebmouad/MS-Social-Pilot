import { z } from 'zod';
import { WorkspaceRole } from '@prisma/client';

import { requireCapability } from '@/lib/auth';
import { canManageTeam } from '@/lib/constants';
import { changeRole, removeMember, revokeInvitation } from '@/lib/team';
import { ok, readJson, route } from '@/lib/api';

const patchSchema = z.object({ role: z.nativeEnum(WorkspaceRole) });

type Context = { params: Promise<{ id: string }> };

/** Change a member's role. `id` is the user id. */
export const PATCH = route(async (request: Request, context: Context) => {
  const auth = await requireCapability(canManageTeam);
  const { id } = await context.params;
  const { role } = patchSchema.parse(await readJson(request));

  await changeRole(auth.workspace.id, id, role);
  return ok({ ok: true });
});

/**
 * Remove a member, or revoke a pending invitation.
 *
 * `?type=invitation` distinguishes the two, since one takes a user id and the
 * other an invitation id.
 */
export const DELETE = route(async (request: Request, context: Context) => {
  const auth = await requireCapability(canManageTeam);
  const { id } = await context.params;
  const type = new URL(request.url).searchParams.get('type');

  if (type === 'invitation') {
    await revokeInvitation(auth.workspace.id, id);
  } else {
    await removeMember(auth.workspace.id, id);
  }

  return ok({ ok: true });
});
