import { requireAuth } from '@/lib/auth';
import { removeTarget, setTargetEnabled } from '@/lib/connections';
import { targetUpdateSchema } from '@/lib/validation';
import { fail, ok, readJson, route } from '@/lib/api';
import { errors } from '@/lib/errors';
import { z } from 'zod';

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
  if (result.outcome === 'blocked') {
    // The reason is what Facebook said when the destination was last checked,
    // passed through untranslated like every Graph message; only the fallback
    // for a blocker with no recorded reason is ours to translate.
    if (result.reason) return fail(result.reason, 409);
    throw errors.destinationBlocked();
  }

  // Passed on rather than dropped: turning a destination off does not stop
  // Facebook publishing what it already holds, and this is the moment somebody
  // would want to know that.
  return ok({
    id,
    enabled: input.enabled ?? true,
    stillScheduledOnFacebook: result.stillScheduledOnFacebook,
  });
});

/**
 * Remove a destination from the workspace (admin and above, like
 * disconnecting the account it came from). Posts Facebook was holding for it
 * are deleted there first; the ones it would not drop are counted back.
 */
export const DELETE = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const input = z.object({ deleteData: z.boolean().default(true) }).parse((await readJson(request).catch(() => ({}))) ?? {});

  const result = await removeTarget({
    workspaceId: auth.workspace.id,
    role: auth.role,
    targetId: id,
    actorId: auth.user.id,
    deleteData: input.deleteData,
  });

  if (result.outcome === 'forbidden') throw errors.adminsOnlyDestinations();
  if (result.outcome === 'not_found') throw errors.destinationNotFound();

  return ok({ id, removed: input.deleteData, disconnected: !input.deleteData, stillScheduledOnFacebook: result.stillScheduledOnFacebook });
});
