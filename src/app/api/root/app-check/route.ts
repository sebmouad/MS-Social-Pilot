import { requireRootApi } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { checkApp } from '@/lib/health';

/** Ask Facebook whether the configured app ID and secret work: one Graph call. Root only. */
export const POST = route(async () => {
  await requireRootApi();
  const app = await checkApp();
  return ok({ configured: app.configured, valid: app.valid, appId: app.appId, headline: app.headline });
});
