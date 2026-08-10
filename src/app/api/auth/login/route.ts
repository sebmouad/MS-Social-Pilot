import { authenticate, setSessionCookie } from '@/lib/auth';
import { loginSchema } from '@/lib/validation';
import { ok, readJson, route } from '@/lib/api';

export const POST = route(async (request: Request) => {
  const { email, password } = loginSchema.parse(await readJson(request));
  const token = await authenticate(email, password);
  await setSessionCookie(token);
  return ok({ ok: true });
});
