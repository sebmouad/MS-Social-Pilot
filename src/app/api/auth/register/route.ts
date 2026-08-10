import { Locale } from '@prisma/client';

import { registerUser, setSessionCookie } from '@/lib/auth';
import { registerSchema } from '@/lib/validation';
import { resolveLocale } from '@/i18n/locale';
import { ok, readJson, route } from '@/lib/api';

export const POST = route(async (request: Request) => {
  const input = registerSchema.parse(await readJson(request));

  // Start people in the language they arrived in; they can change it later.
  const locale = await resolveLocale().catch(() => Locale.en);

  // The workspace, its default queue slots and the owner's notification
  // preferences are all created by `createWorkspace`. Seeding any of them here
  // as well is what caused a duplicate-key failure on sign-up.
  const { userId, token } = await registerUser({ ...input, locale });

  await setSessionCookie(token);
  return ok({ userId }, 201);
});
