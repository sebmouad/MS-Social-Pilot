import { z } from 'zod';

import { requireCapability } from '@/lib/auth';
import { canManageAccounts } from '@/lib/constants';
import { AppError } from '@/lib/errors';
import { ok, readJson, route } from '@/lib/api';
import { logActivity } from '@/lib/scheduler/runner';
import { connectBluesky, saveNetworkAccount } from '@/lib/networks/connect';
import { GraphError } from '@/lib/facebook/graph';

const schema = z.object({
  identifier: z.string().trim().min(3).max(253),
  /** Bluesky app passwords look like xxxx-xxxx-xxxx-xxxx. */
  appPassword: z
    .string()
    .trim()
    .regex(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i, 'Use an app password (xxxx-xxxx-xxxx-xxxx), not your account password.'),
});

/** Connect a Bluesky account with an app password made in Bluesky's settings. */
export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canManageAccounts);
  const input = schema.parse(await readJson(request));
  try {
    const connected = await connectBluesky(input.identifier, input.appPassword);
    const saved = await saveNetworkAccount({ workspaceId: auth.workspace.id, key: 'bluesky', connected });
    await logActivity(auth.workspace.id, 'account.connected', { provider: 'bluesky' }, auth.user.id);
    return ok({ connected: saved.targets }, 201);
  } catch (error) {
    if (error instanceof GraphError && (error.kind === 'auth' || error.httpStatus === 401 || error.httpStatus === 400)) {
      throw new AppError({ key: 'errors.blueskySignIn', fallback: 'Bluesky did not accept that handle and app password.', status: 422 });
    }
    throw error;
  }
});
