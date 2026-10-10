import { requireAuth } from '@/lib/auth';
import { createLabel, labelSchema, listLabels } from '@/lib/page-groups';
import { ok, readJson, route } from '@/lib/api';

export const GET = route(async () => {
  const auth = await requireAuth();
  return ok({ labels: await listLabels(auth.workspace.id) });
});

/**
 * Make a label. Anybody who writes posts may: a label is typed while tagging
 * a post, and sending a contributor off to ask an admin for one would stop
 * them mid-sentence.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = labelSchema.parse(await readJson(request));
  return ok({ label: await createLabel(auth.workspace.id, input) }, 201);
});
