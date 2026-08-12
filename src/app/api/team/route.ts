import { z } from 'zod';
import { WorkspaceRole } from '@prisma/client';

import { requireAuth, requireCapability } from '@/lib/auth';
import { canManageTeam } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { inviteMember } from '@/lib/team';
import { ok, readJson, route } from '@/lib/api';

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  role: z.nativeEnum(WorkspaceRole).default(WorkspaceRole.contributor),
});

export const GET = route(async () => {
  const auth = await requireAuth();

  const [members, invitations] = await Promise.all([
    prisma.membership.findMany({
      where: { workspaceId: auth.workspace.id },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invitation.findMany({
      where: { workspaceId: auth.workspace.id, acceptedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return ok({
    members: members.map((membership) => ({
      userId: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      role: membership.role,
      isSelf: membership.user.id === auth.user.id,
    })),
    invitations: invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    })),
  });
});

export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canManageTeam);
  const input = inviteSchema.parse(await readJson(request));

  const result = await inviteMember({
    workspaceId: auth.workspace.id,
    invitedById: auth.user.id,
    actorRole: auth.role,
    email: input.email,
    role: input.role,
  });

  return ok(result, 201);
});
