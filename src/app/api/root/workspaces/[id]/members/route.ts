import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';

import { requireRootApi } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { addMember } from '@/lib/root';

const schema = z.object({
  email: z.string().trim().email().max(254),
  role: z.nativeEnum(WorkspaceRole),
});

/** Root adds an existing account to a workspace. Root only (404 for everyone else). */
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireRootApi();
  const { id } = await params;
  const { email, role } = schema.parse(await readJson(request));
  await addMember(auth.user.id, id, email, role);
  return ok({ ok: true }, 201);
});
