import { requireAuth } from '@/lib/auth';
import { releaseHeldPosts } from '@/lib/approvals';
import { canManageSettings } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { workspaceSettingsSchema } from '@/lib/validation';
import { ok, readJson, route } from '@/lib/api';
import { errors } from '@/lib/errors';

export const PATCH = route(async (request: Request) => {
  const auth = await requireAuth();
  if (!canManageSettings(auth.role)) {
    throw errors.adminsOnlySettings();
  }

  const input = workspaceSettingsSchema.parse(await readJson(request));

  // Only fields the request actually sent are written; an empty string is a
  // deliberate "clear this", which is why these are nullable in the schema.
  const data: Record<string, unknown> = {};
  const assign = (key: string, value: unknown) => {
    if (value !== undefined) data[key] = value === '' ? null : value;
  };

  assign('name', input.name);
  assign('timezone', input.timezone);
  assign('defaultLocale', input.defaultLocale);
  assign('requiresApproval', input.requiresApproval);
  assign('utmSource', input.utmSource);
  assign('utmMedium', input.utmMedium);
  assign('utmCampaignTemplate', input.utmCampaignTemplate);
  assign('shortenerEnabled', input.shortenerEnabled);
  assign('aiEnabled', input.aiEnabled);
  assign('aiTone', input.aiTone);
  assign('aiBrandVoice', input.aiBrandVoice);

  const workspace = await prisma.workspace.update({ where: { id: auth.workspace.id }, data });

  // Turning review off has to free whatever it was holding, or those posts sit
  // in `pending` for ever with the screen that would clear them now hidden.
  // Passed back rather than dropped: flipping this frees everything review was
  // holding, and the ones whose moment has gone are on Facebook within the next
  // tick. The person who flipped it should hear that from the switch, not from
  // a client.
  const released =
    input.requiresApproval === false
      ? await releaseHeldPosts({ workspaceId: auth.workspace.id, userId: auth.user.id })
      : null;

  return ok({
    id: workspace.id,
    name: workspace.name,
    timezone: workspace.timezone,
    ...(released && released.released > 0 ? { released } : {}),
  });
});
