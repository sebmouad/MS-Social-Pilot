import { endRootVisit, requireRootApi } from '@/lib/auth';
import { ok, route } from '@/lib/api';

/** Root leaves the workspace they were looking after. */
export const DELETE = route(async () => {
  await requireRootApi();
  await endRootVisit();
  return ok({ ok: true });
});
