import { z } from 'zod';

import { requireRootApi } from '@/lib/auth';
import { fail, ok, readJson, route } from '@/lib/api';
import { logRootActivity } from '@/lib/root';
import {
  SETTINGS_BY_KEY,
  SettingError,
  describeSettings,
  writeSettings,
} from '@/lib/settings';

/**
 * Instance configuration.
 *
 * Root only in both directions (404 for everyone else). Reading matters as
 * much as writing: the list reveals which integrations are configured, and on
 * a shared installation that is not an admin-for-one-client's business.
 */
export const GET = route(async () => {
  await requireRootApi();

  return ok({ settings: await describeSettings() });
});

const schema = z.object({
  /** Key to value. A null value clears the override. */
  values: z.record(z.string(), z.unknown()),
});

export const POST = route(async (request: Request) => {
  const auth = await requireRootApi();

  const input = schema.parse(await readJson(request));

  const unknown = Object.keys(input.values).filter((key) => !SETTINGS_BY_KEY.has(key));
  if (unknown.length > 0) return fail(`Unknown setting: ${unknown.join(', ')}.`, 400);

  const changed = Object.keys(input.values);

  try {
    await writeSettings(input.values, auth.user.id);
  } catch (error) {
    if (error instanceof SettingError) return fail(error.message, 422);
    throw error;
  }

  // Secrets are never named in the audit trail beyond their key, which is not
  // sensitive — the value is.
  await logRootActivity(auth.user.id, 'config.changed', { keys: changed.join(', ') });

  return ok({ settings: await describeSettings(), changed: changed.length });
});
