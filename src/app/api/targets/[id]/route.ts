import { requireAuth } from '@/lib/auth';
import { setTargetEnabled } from '@/lib/connections';
import { targetUpdateSchema } from '@/lib/validation';
import { fail, ok, readJson, route } from '@/lib/api';
import { errors } from '@/lib/errors';

/**
 * Enable or disable a destination in the composer.
 *
 * Admin and above: this is not a per-user preference. Turning a page off stops
 * it appearing for everyone in the workspace and takes it out of every future
 * post, which is not a contributor's decision to make.
 */
export const PATCH = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const input = targetUpdateSchema.parse(await readJson(request));

  const result = await setTargetEnabled({
    workspaceId: auth.workspace.id,
    role: auth.role,
    targetId: id,
    enabled: input.enabled ?? true,
  });

  if (result.outcome === 'forbidden') {
    throw errors.adminsOnlyDestinations();
  }
  if (result.outcome === 'not_found') throw errors.destinationNotFound();
  if (result.outcome === 'blocked') return fail(result.reason ?? 'Cannot enable this destination.', 409);

  // Passed on rather than dropped: turning a destination off does not stop
  // Facebook publishing what it already holds, and this is the moment somebody
  // would want to know that.
  return ok({
    id,
    enabled: input.enabled ?? true,
    stillScheduledOnFacebook: result.stillScheduledOnFacebook,
  });
});
