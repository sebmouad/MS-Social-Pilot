import { z } from 'zod';
import { WorkspaceRole } from '@prisma/client';

import { requireCapability } from '@/lib/auth';
import { canManageTeam } from '@/lib/constants';
import { changeRole, removeMember, revokeInvitation, setPageAccess } from '@/lib/team';
import { ok, readJson, route } from '@/lib/api';

const patchSchema = z.union([
  z.object({ role: z.nativeEnum(WorkspaceRole) }),
  z.object({
    pages: z.object({ all: z.boolean(), targetIds: z.array(z.string().min(1)).max(500).default([]) }),
  }),
]);

type Context = { params: Promise<{ id: string }> };

/**
 * Change a member's role, or the Pages they may work on. `id` is the user id.
 *
 * The caller's own role goes down with the request: `canManageTeam` lets admins
 * in, and an admin creating an owner would be handing themselves the
 * instance-wide settings.
 */
export const PATCH = route(async (request: Request, context: Context) => {
  const auth = await requireCapability(canManageTeam);
  const { id } = await context.params;
  const input = patchSchema.parse(await readJson(request));

  if ('pages' in input) {
    await setPageAccess(auth.workspace.id, id, input.pages, auth.role);
  } else {
    await changeRole(auth.workspace.id, id, input.role, auth.role);
  }
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
    await removeMember(auth.workspace.id, id, auth.role);
  }

  return ok({ ok: true });
});
