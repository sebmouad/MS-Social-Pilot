import { requireRootApi } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { logRootActivity } from '@/lib/root';
import { adoptEnvironmentSettings } from '@/lib/settings';

/**
 * Move every setting still read from `.env` into the database, where the
 * Configuration screen manages it. Root only (404 for everyone else).
 */
export const POST = route(async () => {
  const auth = await requireRootApi();
  const { moved, invalid } = await adoptEnvironmentSettings(auth.user.id);
  if (moved.length > 0) await logRootActivity(auth.user.id, 'config.changed', { keys: moved.join(', ') });
  return ok({ moved: moved.length, invalid: invalid.length });
});
