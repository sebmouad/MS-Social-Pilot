import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { canManageInstance } from '@/lib/constants';
import { fail, ok, readJson, route } from '@/lib/api';
import { logActivity } from '@/lib/scheduler/runner';
import {
  SETTINGS_BY_KEY,
  SettingError,
  clearSetting,
  describeSettings,
  writeSetting,
} from '@/lib/settings';

/**
 * Instance configuration.
 *
 * Owner-only in both directions. Reading matters as much as writing: the list
 * reveals which integrations are configured, and on a shared installation that
 * is not an admin-for-one-client's business.
 */
export const GET = route(async () => {
  const auth = await requireAuth();
  if (!canManageInstance(auth.role)) return fail('Only an owner can view configuration.', 403);

  return ok({ settings: await describeSettings() });
});

const schema = z.object({
  /** Key to value. A null value clears the override. */
  values: z.record(z.string(), z.unknown()),
});

export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  if (!canManageInstance(auth.role)) return fail('Only an owner can change configuration.', 403);

  const input = schema.parse(await readJson(request));

  const unknown = Object.keys(input.values).filter((key) => !SETTINGS_BY_KEY.has(key));
  if (unknown.length > 0) return fail(`Unknown setting: ${unknown.join(', ')}.`, 400);

  const changed: string[] = [];

  try {
    for (const [key, value] of Object.entries(input.values)) {
      if (value === null) {
        await clearSetting(key);
      } else {
        await writeSetting(key, value, auth.user.id);
      }
      changed.push(key);
    }
  } catch (error) {
    if (error instanceof SettingError) return fail(error.message, 422);
    throw error;
  }

  // Secrets are never named in the audit trail beyond their key, which is not
  // sensitive — the value is.
  await logActivity(auth.workspace.id, 'settings.changed', { keys: changed });

  return ok({ settings: await describeSettings(), changed: changed.length });
});
