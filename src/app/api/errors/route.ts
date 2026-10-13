import { z } from 'zod';

import { ok, readJson, route } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { recordError } from '@/lib/error-tracking';

const bodySchema = z.object({
  name: z.string().max(100).default('Error'),
  message: z.string().max(2000),
  stack: z.string().max(8000).optional(),
  path: z.string().max(500).optional(),
});

/** A signed-in person's browser may report this many errors per window. */
const PER_WINDOW = 20;
const WINDOW_MS = 10 * 60 * 1000;
const recent = new Map<string, number[]>();

/**
 * Browser errors for root's error list. Signed-in people
 * only, a few at a time, so the endpoint cannot be used to fill the table.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const now = Date.now();
  const times = (recent.get(auth.user.id) ?? []).filter((at) => now - at < WINDOW_MS);
  if (times.length >= PER_WINDOW) return ok({ ok: false });
  recent.set(auth.user.id, [...times, now]);

  const body = bodySchema.parse(await readJson(request));
  const error = Object.assign(new Error(body.message), { name: body.name, stack: body.stack });
  await recordError({ source: 'browser', error, location: body.path });
  return ok({ ok: true });
});
