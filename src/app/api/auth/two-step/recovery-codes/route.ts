import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { verifyPassword } from '@/lib/crypto';
import { errors } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { newRecoveryCodes } from '@/lib/two-step';

const schema = z.object({ password: z.string().min(1) });

/** Ten new recovery codes; the old ones stop working. Needs the password. */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const { password } = schema.parse(await readJson(request));
  const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
  if (!verifyPassword(password, user.passwordHash)) throw errors.currentPasswordWrong();
  return ok({ recoveryCodes: await newRecoveryCodes(auth.user.id) });
});
