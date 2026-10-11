import { requireRootApi } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { notify } from '@/lib/system-alerts';

/** Send a test alert to the configured email and Telegram chat. Root only (404 for everyone else). */
export const POST = route(async () => {
  await requireRootApi();
  await notify('worker.down', 'test', {});
  return ok({ ok: true });
});
